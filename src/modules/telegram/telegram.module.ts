import { Module } from '@nestjs/common';
import { TelegramService } from './telegram-service';
import { KeyPurchaseModule } from '../key-purchase/key-purchase.module';
import { YooMoneyModule } from '../yoomoney/yoomoney.module';

@Module({
  imports: [KeyPurchaseModule, YooMoneyModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
