import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TelegramModule } from './telegram/telegram.module';
import { ScheduleModule } from './schedule/schedule.module';
import { TonModule } from './ton/ton.module';
import { TariffsModule } from './tariffs/tariffs.module';
import { BlitzModule } from './blitz/blitz.module';
import { KeyPurchaseModule } from './key-purchase/key-purchase.module';
import { XrayModule } from './xray/xray.module';
import { WechatModule } from './wechat/wechat.module';
import { ApiModule } from './api/api.module';
import { PassimxModule } from './passimx/passimx.module';

@Module({
  imports: [
    PassimxModule,
    XrayModule,
    ScheduleModule,
    DatabaseModule,
    TelegramModule,
    TonModule,
    TariffsModule,
    BlitzModule,
    KeyPurchaseModule,
    WechatModule,
    ApiModule,
  ],
})
export class AppModule {}
