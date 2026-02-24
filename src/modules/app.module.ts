import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TelegramModule } from './telegram/telegram.module';
import { ScheduleModule } from './schedule/schedule.module';
import { TonModule } from './ton/ton.module';
import { TariffsModule } from './tariffs/tariffs.module';
import { BlitzModule } from './blitz/blitz.module';
import { KeyPurchaseModule } from './key-purchase/key-purchase.module';
import { AmneziaModule } from './amnezia/amnezia.module';

@Module({
  imports: [
    AmneziaModule,
    ScheduleModule,
    DatabaseModule,
    TelegramModule,
    TonModule,
    TariffsModule,
    BlitzModule,
    KeyPurchaseModule,
  ],
})
export class AppModule {}
