import { Module } from '@nestjs/common';
import { ScheduleModule as ScheduleModule2 } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';
import { TBankModule } from '../t-bank/t-bank.module';
import { TonModule } from '../ton/ton.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    ScheduleModule2.forRoot(),
    TBankModule,
    TonModule,
    TransactionsModule,
  ],
  providers: [ScheduleService],
})
export class ScheduleModule {}
