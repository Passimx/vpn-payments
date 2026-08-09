import { Module } from '@nestjs/common';
import PassimxService from './passimx.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { ApiModule } from '../api/api.module';

@Module({
  imports: [ApiModule, TransactionsModule],
  providers: [PassimxService],
  exports: [PassimxService],
})
export class PassimxModule {}
