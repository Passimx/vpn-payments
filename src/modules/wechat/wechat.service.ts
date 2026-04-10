import { Injectable } from '@nestjs/common';
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

@Injectable()
export class WechatService {
  private wxPay: WxPay;

  constructor(private readonly em: EntityManager) {
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

  public invoiceCallback(data: InvoiceCallbackType) {
    logger.info(data);
    return data;
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
