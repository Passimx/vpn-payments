import { Module } from '@nestjs/common';
import { TelegramService } from './telegram-service';
import { KeyPurchaseModule } from '../key-purchase/key-purchase.module';
import { YookassaModule } from '../yookassa/yookassa.module';

@Module({
  imports: [KeyPurchaseModule, YookassaModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
