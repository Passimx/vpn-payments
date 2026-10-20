import { Module } from '@nestjs/common';
import { ScheduleModule as ScheduleModule2 } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';
import { TonModule } from '../ton/ton.module';
import { XrayModule } from '../xray/xray.module';
import { TelegramModule } from '../telegram/telegram.module';
import { YookassaModule } from '../yookassa/yookassa.module';

@Module({
  imports: [
    ScheduleModule2.forRoot(),
    TonModule,
    XrayModule,
    TelegramModule,
    YookassaModule,
  ],
  providers: [ScheduleService],
})
export class ScheduleModule {}
