import { Module } from '@nestjs/common';
import { KeyPurchaseService } from './key-purchase.service';
import { BlitzModule } from '../blitz/blitz.module';
import { AmneziaModule } from '../amnezia/amnezia.module';

@Module({
  imports: [BlitzModule, AmneziaModule],
  providers: [KeyPurchaseService],
  exports: [KeyPurchaseService],
})
export class KeyPurchaseModule {}
