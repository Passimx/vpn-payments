import { Module } from '@nestjs/common';
import { KeyPurchaseService } from './key-purchase.service';
import { BlitzModule } from '../blitz/blitz.module';
import { XrayModule } from '../xray/xray.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { I18nModule } from '../i18n/i18n.module';

@Module({
  imports: [BlitzModule, XrayModule, TransactionsModule, I18nModule],
  providers: [KeyPurchaseService],
  exports: [KeyPurchaseService],
})
export class KeyPurchaseModule {}
