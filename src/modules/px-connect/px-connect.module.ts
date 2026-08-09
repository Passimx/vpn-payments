import { Module } from '@nestjs/common';
import PxConnectService from './px-connect.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { ApiModule } from '../api/api.module';

@Module({
  imports: [ApiModule, TransactionsModule],
  providers: [PxConnectService],
  exports: [PxConnectService],
})
export class PxConnectModule {}
