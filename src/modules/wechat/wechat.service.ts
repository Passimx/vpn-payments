import { Injectable } from '@nestjs/common';
import WxPay from 'wechatpay-node-v3';
import * as fs from 'node:fs';
import path from 'node:path';
import { Envs } from '../../common/env/envs';
import { logger } from '../../common/logger/logger';
import { InvoiceCallbackType } from './types/invoice-callback.type';
import { InvoiceCreateType } from './types/invoice-create.type';
import { DataSource, EntityManager, JsonContains } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { WechatTransactionType } from './types/wechat-transaction.type';
import { TransactionsService } from '../transactions/transactions.service';
import { CurrencyEnum } from '../transactions/types/currency.enum';

@Injectable()
export class WechatService {
  private wxPay: WxPay;

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly em: EntityManager,
    private readonly dataSource: DataSource,
  ) {
    this.initWxPay();
  }

  public async createInvoice(
    userId: string,
    amount: number,
  ): Promise<string | undefined> {
    if (!this.wxPay) return;
    const { notify_url } = Envs.wechat;
    if (!notify_url) return;
    const outTradeNo = Date.now().toString();

    const params = {
      description: userId,
      out_trade_no: outTradeNo,
      notify_url,
      amount: {
        total: Math.ceil(amount * 100),
        currency: 'CNY',
      },
    };

    const result = (await this.wxPay.transactions_native(
      params,
    )) as InvoiceCreateType;

    if (result.status !== 200) {
      logger.error(result.error);
      return;
    }

    const url = result.data.code_url;
    await this.em.insert(TransactionEntity, {
      userId: userId,
      amount: params.amount.total / 100,
      currency: CurrencyEnum.CNY,
      type: 'Credit',
      kind: 'Deposit',
      completed: false,
      meta: {
        paymentId: outTradeNo,
        place: 'wechat',
      },
    });

    return url;
  }

  public async invoiceCallback(data: InvoiceCallbackType) {
    if (!data.resource) return logger.error(data);

    const { ciphertext, associated_data, nonce } = data.resource;
    const result = this.wxPay.decipher_gcm<WechatTransactionType>(
      ciphertext,
      associated_data,
      nonce,
    );

    const transaction = await this.em.findOneOrFail(TransactionEntity, {
      where: {
        meta: JsonContains({ paymentId: result.out_trade_no }),
        currency: CurrencyEnum.CNY,
        completed: false,
      },
    });

    await this.dataSource.transaction(async (manager) => {
      await this.transactionsService.addBalance(
        transaction.userId,
        transaction.amount,
        CurrencyEnum.CNY,
        manager,
        true,
      );

      await manager.update(
        TransactionEntity,
        {
          meta: JsonContains({ paymentId: result.out_trade_no }),
          completed: false,
        },
        { completed: true },
      );
    });
  }

  private initWxPay() {
    const certPath = path.join(process.cwd(), 'data/keys');
    const { appid, mchid, key } = Envs.wechat;
    if (!appid || !mchid || !key) {
      logger.info('Missing WeChat config envs');
      return;
    }

    try {
      const publicKey = fs.readFileSync(
        path.join(certPath, 'apiclient_cert.pem'),
      );
      const privateKey = fs.readFileSync(
        path.join(certPath, 'apiclient_key.pem'),
      );

      this.wxPay = new WxPay({
        appid,
        mchid,
        key,
        publicKey,
        privateKey,
      });
    } catch (e) {
      logger.error(e);
      return;
    }
  }
}
