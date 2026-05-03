import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/requests/login.dto';
import { UserId } from '../../../common/guards/user.decorator';
import { Public } from '../../../common/guards/public.decorator';
import { TransactionsService } from '../../transactions/transactions.service';
import { DataResponse } from '../dto/responses/data-response.dto';
import { AuthGuard } from '../../../common/guards/auth.guard';

@Controller()
@UseGuards(AuthGuard)
export class ApiController {
  constructor(
    private readonly authService: AuthService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Post('login-by-telegram')
  @Public()
  loginByTelegram(@Body() body: LoginDto) {
    return this.authService.loginByTelegram(body.key);
  }

  @Get('users/me')
  GetUsersMe(@UserId() userId: string) {
    return this.authService.getUsersMe(userId);
  }

  @Get('currency-price')
  async getCurrencyPrice() {
    const payload = await this.transactionsService.getCurrencyPrice();
    return new DataResponse(payload);
  }
}
