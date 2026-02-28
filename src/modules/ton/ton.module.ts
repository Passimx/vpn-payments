import { Module } from '@nestjs/common';
import { TonService } from './ton.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TransactionsModule, TelegramModule],
  providers: [TonService],
  exports: [TonService],
})
export class TonModule {}
