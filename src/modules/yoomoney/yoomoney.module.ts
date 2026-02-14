import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YooMoneyBalanceService } from './yoomoney-balance.service';
import { YooMoneyBalancePaymentEntity } from '../database/entities/yoomoney-balance.entity';
import { YooMoneyIncomingEntity } from '../database/entities/yoomoney-incoming.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      YooMoneyBalancePaymentEntity,
      YooMoneyIncomingEntity,
    ]),
  ],
  providers: [YooMoneyBalanceService],
  exports: [YooMoneyBalanceService],
})
export class YooMoneyModule {}
