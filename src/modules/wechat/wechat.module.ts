import { forwardRef, Module } from '@nestjs/common';
import { WechatService } from './wechat.service';
import { WechatController } from './wechat.controller';
import { TelegramModule } from '../telegram/telegram.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [forwardRef(() => TelegramModule), TransactionsModule],
  controllers: [WechatController],
  providers: [WechatService],
  exports: [WechatService],
})
export class WechatModule {}
