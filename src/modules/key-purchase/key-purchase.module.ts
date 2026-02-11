import { Module } from '@nestjs/common';
import { KeyPurchaseService } from './key-purchase.service';
import { BlitzModule } from '../blitz/blitz.module';

@Module({
  imports: [BlitzModule],
  providers: [KeyPurchaseService],
  exports: [KeyPurchaseService],
})
export class KeyPurchaseModule {}
