import { Module } from '@nestjs/common';
import { TelegramService } from './telegram-service';
import { KeyPurchaseModule } from '../key-purchase/key-purchase.module';

@Module({
  imports: [KeyPurchaseModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
