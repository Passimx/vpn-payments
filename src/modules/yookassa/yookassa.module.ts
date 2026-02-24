import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YookassaBalanceService } from './yookassa-balance.service';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { YooKassaWebhookController } from './yookassa-webhook.controller';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionEntity]),
    forwardRef(() => TelegramModule),
  ],
  providers: [YookassaBalanceService],
  controllers: [YooKassaWebhookController],
  exports: [YookassaBalanceService],
})
export class YookassaModule {}
