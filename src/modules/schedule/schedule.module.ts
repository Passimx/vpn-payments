import { Module } from '@nestjs/common';
import { ScheduleModule as ScheduleModule2 } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';
import { TonModule } from '../ton/ton.module';
import { XrayModule } from '../xray/xray.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [ScheduleModule2.forRoot(), TonModule, XrayModule, TelegramModule],
  providers: [ScheduleService],
})
export class ScheduleModule {}
