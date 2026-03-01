import { forwardRef, Module } from '@nestjs/common';
import { AmneziaService } from './amnezia-service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [forwardRef(() => TelegramModule)],
  providers: [AmneziaService],
  exports: [AmneziaService],
})
export class AmneziaModule {}
