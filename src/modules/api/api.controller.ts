import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { LoginDto } from './dto/requests/login.dto';
import { UserId } from '../../common/guards/user.decorator';
import { Public } from '../../common/guards/public.decorator';

@Controller('api')
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
