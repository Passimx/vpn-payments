import { Module } from '@nestjs/common';
import { BlitzService } from './blitz.service';

@Module({
  providers: [BlitzService],
  exports: [BlitzService],
})
export class BlitzModule {}
