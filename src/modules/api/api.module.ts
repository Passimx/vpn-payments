import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { AuthService } from './services/auth.service';

@Module({
  providers: [AuthService],
  controllers: [ApiController],
  exports: [AuthService],
})
export class ApiModule {}
