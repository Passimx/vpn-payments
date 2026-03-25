import { forwardRef, Module } from '@nestjs/common';
import { AmneziaService } from './amnezia-service';
import { TelegramModule } from '../telegram/telegram.module';
import { AmneziaController } from './amnezia.controller';
import { I18nModule } from '../i18n/i18n.module';

@Module({
  imports: [forwardRef(() => TelegramModule), I18nModule],
  providers: [AmneziaService],
  controllers: [AmneziaController],
  exports: [AmneziaService],
})
export class AmneziaModule {}
