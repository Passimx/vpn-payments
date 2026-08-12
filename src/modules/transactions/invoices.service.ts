import { Injectable } from '@nestjs/common';
import { YookassaBalanceService } from '../yookassa/yookassa-balance.service';
import { WechatService } from '../wechat/wechat.service';
import { CurrencyEnum } from './types/currency.enum';
import { TonService } from '../ton/ton.service';
import { AppWalletEnum } from '../ton/enums/app-wallet.enum';
import { createCanvas, loadImage } from 'canvas';
import * as QRCode from 'qrcode';
import path from 'node:path';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly yookassaBalanceService: YookassaBalanceService,
    private readonly wechatService: WechatService,
    private readonly tonService: TonService,
  ) {}

  public async getSberInvoice(userId: string, amount: number) {
    return this.yookassaBalanceService.createInvoice(userId, amount);
  }

  public async getWechatInvoice(userId: string, amount: number) {
    return await this.wechatService.createInvoice(userId, amount);
  }

  public getTonInvoice(
    userId: string,
    amount: number,
    currency: CurrencyEnum.TON | CurrencyEnum.USD,
    app: AppWalletEnum,
  ) {
    return this.tonService.getTonInvoice(userId, amount, currency, app);
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
}
