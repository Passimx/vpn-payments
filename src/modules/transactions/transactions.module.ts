import { forwardRef, Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TelegramModule } from '../telegram/telegram.module';
import { InvoicesService } from './invoices.service';
import { TonModule } from '../ton/ton.module';
import { WechatModule } from '../wechat/wechat.module';
import { YookassaModule } from '../yookassa/yookassa.module';

@Module({
  imports: [
    forwardRef(() => TelegramModule),
    TonModule,
    WechatModule,
    YookassaModule,
  ],
  providers: [TransactionsService, InvoicesService],
  exports: [TransactionsService, InvoicesService],
})
export class TransactionsModule {}
