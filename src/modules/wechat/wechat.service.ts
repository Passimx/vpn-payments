import { forwardRef, Inject, Injectable } from '@nestjs/common';
import WxPay from 'wechatpay-node-v3';
import * as fs from 'node:fs';
import path from 'node:path';
import { Envs } from '../../common/env/envs';
import { OrderType } from './types/order.type';
import { logger } from '../../common/logger/logger';
import { InvoiceCallbackType } from './types/invoice-callback.type';
import { createCanvas, loadImage } from 'canvas';
import * as QRCode from 'qrcode';
import { InvoiceCreateType } from './types/invoice-create.type';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { WechatTransactionType } from './types/wechat-transaction.type';
import { TelegramService } from '../telegram/telegram-service';
import { UserEntity } from '../database/entities/user.entity';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class WechatService {
  private wxPay: WxPay;

  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly transactionsService: TransactionsService,
    private readonly em: EntityManager,
  ) {
    this.initWxPay();
  }

  public async createInvoice(orderData: OrderType) {
    if (!this.wxPay) return;
    const { notify_url } = Envs.wechat;
    if (!notify_url) return;

    const params = {
      description: orderData.userId,
      out_trade_no: orderData.outTradeNo,
      notify_url,
      amount: {
        total: Math.ceil(orderData.amount * 100),
        currency: 'CNY',
      },
    };

    const result = (await this.wxPay.transactions_native(
      params,
    )) as InvoiceCreateType;

    if (result.status !== 200) {
      logger.error(result.error);
      return null;
    }

    const url = result.data.code_url;
    const now = Date.now();
    await this.em.insert(TransactionEntity, {
      id: BigInt(now),
      userId: orderData.userId,
      paymentId: orderData.outTradeNo,
      amount: params.amount.total / 100,
      currency: 'cny',
      type: 'Credit',
      place: 'wechat',
      completed: false,
      paymentUrl: url,
      createdAt: now,
    });

    const size = 400;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const qrCanvas = createCanvas(size, size);
    await QRCode.toCanvas(qrCanvas, url, {
      errorCorrectionLevel: 'H',
      width: size,
      margin: 1,
      color: {
        light: '#ffffff',
        dark: '#062846',
      },
    });

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(qrCanvas, 0, 0);

    const logo = await loadImage(
      path.join(__dirname, '../../public/media/logo.png'),
    );

    const logoSize = size * 0.8;
    const x = (size - logoSize) / 2;
    const y = (size - logoSize) / 2;

    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.drawImage(logo, x, y, logoSize, logoSize);
    ctx.restore();

    return canvas.toBuffer();
  }

  public async invoiceCallback(data: InvoiceCallbackType) {
    if (!data.resource) return logger.error(data);

    const { ciphertext, associated_data, nonce } = data.resource;
    const result = this.wxPay.decipher_gcm<WechatTransactionType>(
      ciphertext,
      associated_data,
      nonce,
    );

    const price = await this.transactionsService.getCurrencyPrice();
    if (!price) return;

    const transaction = await this.em.findOneOrFail(TransactionEntity, {
      where: {
        paymentId: result.out_trade_no,
        place: 'wechat',
        currency: 'cny',
      },
    });

    const addBalance = (transaction.amount / price.usd.cny) * price.usd.rub;

    await this.em
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        balance: () => `balance + ${addBalance}`,
      })
      .where('id = :id', { id: transaction.userId })
      .execute();

    await this.em.update(
      TransactionEntity,
      {
        paymentId: result.out_trade_no,
        place: 'wechat',
        currency: 'cny',
      },
      {
        id: BigInt(result.transaction_id),
        completed: true,
      },
    );
    await this.telegramService.sendMessageAddBalance(
      transaction.userId,
      addBalance,
    );
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
