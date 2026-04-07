import { Module } from '@nestjs/common';
import { KeyPurchaseService } from './key-purchase.service';
import { BlitzModule } from '../blitz/blitz.module';
import { XrayModule } from '../xray/xray.module';

@Module({
  imports: [BlitzModule, XrayModule],
  providers: [KeyPurchaseService],
  exports: [KeyPurchaseService],
})
export class KeyPurchaseModule {}
