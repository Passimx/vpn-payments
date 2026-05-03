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

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: Envs.main.jwtSecret,
    }),
    TransactionsModule,
    YookassaModule,
    WechatModule,
  ],
  providers: [AuthService, InvoicesService],
  controllers: [ApiController, InvoicesController],
  exports: [AuthService],
})
export class ApiModule {}
