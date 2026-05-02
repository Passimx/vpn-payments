import { Module } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { JwtModule } from '@nestjs/jwt';
import { Envs } from '../../common/env/envs';
import { TransactionsModule } from '../transactions/transactions.module';
import { ApiController } from './controllers/api.controller';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: Envs.main.jwtSecret,
    }),
    TransactionsModule,
  ],
  providers: [AuthService],
  controllers: [ApiController],
  exports: [AuthService],
})
export class ApiModule {}
