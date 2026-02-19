import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YookassaBalanceService } from './yookassa-balance.service';
import { YooKassaBalancePaymentEntity } from '../database/entities/yookassa-balance.entity';
import { YooKassaWebhookController } from './yookassa-webhook.controller';

@Module({
  imports: [TypeOrmModule.forFeature([YooKassaBalancePaymentEntity])],
  providers: [YookassaBalanceService],
  controllers: [YooKassaWebhookController],
  exports: [YookassaBalanceService],
})
export class YookassaModule {}
