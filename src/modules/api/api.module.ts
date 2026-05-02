import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { AuthService } from './services/auth.service';
import { JwtModule } from '@nestjs/jwt';
import { Envs } from '../../common/env/envs';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: Envs.main.jwtSecret,
    }),
  ],
  providers: [AuthService],
  controllers: [ApiController],
  exports: [AuthService],
})
export class ApiModule {}
