import { forwardRef, Module } from '@nestjs/common';
import { AmneziaService } from './amnezia-service';
import { TelegramModule } from '../telegram/telegram.module';
import { AmneziaController } from './amnezia.controller';

@Module({
  imports: [forwardRef(() => TelegramModule)],
  providers: [AmneziaService],
  controllers: [AmneziaController],
  exports: [AmneziaService],
})
export class AmneziaModule {}
