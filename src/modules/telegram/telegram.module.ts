import { Module } from '@nestjs/common';
import { TelegramService } from './telegram-service';
import { KeyPurchaseModule } from '../key-purchase/key-purchase.module';
import { YookassaModule } from '../yookassa/yookassa.module';
import { XrayModule } from '../xray/xray.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { I18nModule } from '../i18n/i18n.module';
import { AnalyticsService } from './analytics.service';
import { WechatModule } from '../wechat/wechat.module';

@Module({
  imports: [
    I18nModule,
    TransactionsModule,
    KeyPurchaseModule,
    XrayModule,
    YookassaModule,
    WechatModule,
  ],
  providers: [TelegramService, AnalyticsService],
  exports: [TelegramService, AnalyticsService],
})
export class TelegramModule {}
