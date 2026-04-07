import { forwardRef, Module } from '@nestjs/common';
import { XrayService } from './xray-service';
import { TelegramModule } from '../telegram/telegram.module';
import { XrayController } from './xray.controller';
import { I18nModule } from '../i18n/i18n.module';

@Module({
  imports: [forwardRef(() => TelegramModule), I18nModule],
  providers: [XrayService],
  controllers: [XrayController],
  exports: [XrayService],
})
export class XrayModule {}
