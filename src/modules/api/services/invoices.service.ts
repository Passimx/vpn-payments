import { Injectable } from '@nestjs/common';
import { YookassaBalanceService } from '../../yookassa/yookassa-balance.service';
import { WechatService } from '../../wechat/wechat.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly yookassaBalanceService: YookassaBalanceService,
    private readonly wechatService: WechatService,
  ) {}

  public async getSberInvoice(userId: string, amount: number) {
    return this.yookassaBalanceService.createBalancePaymentLink(userId, amount);
  }

  public async getWechatInvoice(userId: string, amount: number) {
    return await this.wechatService.createInvoice(userId, amount);
  }

  // public async getTonInvoice(userId: string, body: GetInvoiceDto) {}
}
