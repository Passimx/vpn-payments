import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YookassaBalanceService } from './yookassa-balance.service';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { YooKassaWebhookController } from './yookassa-webhook.controller';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionEntity]), TransactionsModule],
  providers: [YookassaBalanceService],
  controllers: [YooKassaWebhookController],
  exports: [YookassaBalanceService],
})
export class YookassaModule {}
