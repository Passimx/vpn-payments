import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TelegramModule],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
