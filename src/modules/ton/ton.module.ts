import { Module } from '@nestjs/common';
import { TonService } from './ton.service';

@Module({
  providers: [TonService],
  exports: [TonService],
})
export class TonModule {}
