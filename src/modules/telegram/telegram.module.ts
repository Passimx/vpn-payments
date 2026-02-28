import { Module } from '@nestjs/common';
import { TelegramService } from './telegram-service';
import { KeyPurchaseModule } from '../key-purchase/key-purchase.module';
import { YookassaModule } from '../yookassa/yookassa.module';
import { AmneziaModule } from '../amnezia/amnezia.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    TransactionsModule,
    KeyPurchaseModule,
    AmneziaModule,
    YookassaModule,
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
