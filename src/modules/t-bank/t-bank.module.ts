import { Module } from '@nestjs/common';
import { TBankService } from './t-bank.service';

@Module({
  providers: [TBankService],
  exports: [TBankService],
})
export class TBankModule {}
