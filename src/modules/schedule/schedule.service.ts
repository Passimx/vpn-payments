import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TonService } from '../ton/ton.service';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly tonService: TonService,
    private readonly transactionsService: TransactionsService,
  ) {}

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
}
