import { Module } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { JwtModule } from '@nestjs/jwt';
import { Envs } from '../../common/env/envs';
import { TransactionsModule } from '../transactions/transactions.module';
import { ApiController } from './controllers/api.controller';
import { InvoicesController } from './controllers/invoices.controller';
import { InvoicesService } from './services/invoices.service';
import { YookassaModule } from '../yookassa/yookassa.module';
import { WechatModule } from '../wechat/wechat.module';
import { TonModule } from '../ton/ton.module';
import { KeyPurchaseModule } from '../key-purchase/key-purchase.module';
import { XrayModule } from '../xray/xray.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: Envs.main.jwtSecret,
    }),
    TransactionsModule,
    YookassaModule,
    WechatModule,
    TonModule,
    KeyPurchaseModule,
    XrayModule,
  ],
  providers: [AuthService, InvoicesService],
  controllers: [ApiController, InvoicesController],
  exports: [AuthService],
})
export class ApiModule {}
