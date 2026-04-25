import { Module } from '@nestjs/common';
import { TonService } from './ton.service';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [TransactionsModule],
  providers: [TonService],
  exports: [TonService],
})
export class TonModule {}
