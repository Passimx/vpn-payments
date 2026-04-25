import { forwardRef, Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [forwardRef(() => TelegramModule)],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
