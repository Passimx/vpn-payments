import { Module } from '@nestjs/common';
import { ScheduleModule as ScheduleModule2 } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';
import { TonModule } from '../ton/ton.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [ScheduleModule2.forRoot(), TonModule, TransactionsModule],
  providers: [ScheduleService],
})
export class ScheduleModule {}
