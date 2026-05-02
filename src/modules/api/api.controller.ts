import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { LoginDto } from './dto/requests/login.dto';
import { UserId } from '../../common/guards/user.decorator';
import { Public } from '../../common/guards/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';

@Controller('api')
@UseGuards(AuthGuard)
export class ApiController {
  constructor(private readonly authService: AuthService) {}

  @Post('login-by-telegram')
  @Public()
  loginByTelegram(@Body() body: LoginDto) {
    return this.authService.loginByTelegram(body.key);
  }

  @Get('/users/me')
  GetUsersMe(@UserId() userId: string) {
    return this.authService.getUsersMe(userId);
  }
}
