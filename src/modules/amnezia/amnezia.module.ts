import { Module } from '@nestjs/common';
import { AmneziaService } from './amnezia-service';

@Module({
  providers: [AmneziaService],
  exports: [AmneziaService],
})
export class AmneziaModule {}
