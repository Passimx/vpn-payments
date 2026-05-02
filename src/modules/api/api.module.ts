import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { AuthService } from './services/auth.service';
import { JwtModule } from '@nestjs/jwt';
import { Envs } from '../../common/env/envs';
import { AuthGuard } from '../../common/guards/auth.guard';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: Envs.main.jwtSecret,
    }),
  ],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [ApiController],
  exports: [AuthService],
})
export class ApiModule {}
