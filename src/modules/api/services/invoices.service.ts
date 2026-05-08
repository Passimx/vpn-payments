import { Injectable } from '@nestjs/common';
import { YookassaBalanceService } from '../../yookassa/yookassa-balance.service';
import { WechatService } from '../../wechat/wechat.service';
import { CurrencyEnum } from '../../transactions/types/currency.enum';
import { TonService } from '../../ton/ton.service';
import { AppWalletEnum } from '../../ton/enums/app-wallet.enum';

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

  public async getTonInvoice(
    userId: string,
    amount: number,
    currency: CurrencyEnum.TON | CurrencyEnum.TON_USDT,
    app: AppWalletEnum,
  ) {
    return await this.tonService.getTonInvoice(userId, amount, currency, app);
  }
}
