import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TelegramModule } from './telegram/telegram.module';
import { ScheduleModule } from './schedule/schedule.module';
import { TonModule } from './ton/ton.module';

@Module({
  imports: [ScheduleModule, DatabaseModule, TelegramModule, TonModule],
})
export class AppModule {}
