import { Injectable } from '@nestjs/common';
import WxPay from 'wechatpay-node-v3';
import * as fs from 'node:fs';
import path from 'node:path';
import { Envs } from '../../common/env/envs';
import { logger } from '../../common/logger/logger';
import { InvoiceCallbackType } from './types/invoice-callback.type';
import { createCanvas, loadImage } from 'canvas';
import * as QRCode from 'qrcode';
import { InvoiceCreateType } from './types/invoice-create.type';
import { EntityManager } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { WechatTransactionType } from './types/wechat-transaction.type';
import { TransactionsService } from '../transactions/transactions.service';
import { DataResponse } from '../api/dto/responses/data-response.dto';

@Injectable()
export class WechatService {
  private wxPay: WxPay;

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly em: EntityManager,
  ) {
    this.initWxPay();
  }

  public async createInvoice(
    userId: string,
    amount: number,
  ): Promise<DataResponse<string>> {
    if (!this.wxPay) return new DataResponse('error');
    const { notify_url } = Envs.wechat;
    if (!notify_url) return new DataResponse('error');
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
      return new DataResponse('error');
    }

    const url = result.data.code_url;
    const now = Date.now();
    await this.em.insert(TransactionEntity, {
      id: BigInt(now),
      userId: userId,
      paymentId: outTradeNo,
      amount: params.amount.total / 100,
      currency: 'cny',
      type: 'Credit',
      place: 'wechat',
      completed: false,
      paymentUrl: url,
      createdAt: now,
    });

    return new DataResponse(url, true);
  }

  public async createImage(url: string) {
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

    const transaction = await this.em.findOneOrFail(TransactionEntity, {
      where: {
        paymentId: result.out_trade_no,
        place: 'wechat',
        currency: 'cny',
        completed: false,
      },
    });

    await this.transactionsService.addBalance(
      transaction.userId,
      transaction.amount,
      'cny',
    );

    await this.em.update(
      TransactionEntity,
      {
        paymentId: result.out_trade_no,
        place: 'wechat',
        currency: 'cny',
      },
      {
        completed: true,
      },
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
