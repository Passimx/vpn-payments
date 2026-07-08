import { Module } from '@nestjs/common';
import { PassimxService } from './passimx.service';

@Module({
  providers: [PassimxService],
  exports: [PassimxService],
})
export class PassimxModule {}
