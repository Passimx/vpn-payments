import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TBankService } from '../t-bank/t-bank.service';
import { TonService } from '../ton/ton.service';
import { TransactionsService } from '../transactions/transactions.service';
import { YooMoneyBalanceService } from '../yoomoney/yoomoney-balance.service';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly tBankService: TBankService,
    private readonly tonService: TonService,
    private readonly transactionsService: TransactionsService,
    private readonly yoomoneyBalanceService: YooMoneyBalanceService,
  ) {}

  // @Cron('*/30 * * * * *')
  async scanTBankTransactions() {
    await this.tBankService.scanTransactions();
  }

  @Cron('* * * * *')
  async scanTonTransactions() {
    await this.tonService.scanTransactions();
  }

  @Cron('*/10 * * * *')
  async scanExchange() {
    await this.transactionsService.scanExchange();
  }

  @Cron('*/10 * * * * *')
  async scanUserTransactions() {
    await this.transactionsService.scanUserTransactions();
  }

  @Cron('*/1 * * * *')
  async scanYooMoneyIncoming() {
    await this.yoomoneyBalanceService.fetchIncomingAndLog();
  }
}
