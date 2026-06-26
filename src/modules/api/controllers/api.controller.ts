import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/requests/login.dto';
import { UserId } from '../../../common/guards/user.decorator';
import { Public } from '../../../common/guards/public.decorator';
import { TransactionsService } from '../../transactions/transactions.service';
import { DataResponse } from '../dto/responses/data-response.dto';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { GetTariffsDto } from '../dto/requests/get-tariffs.dto';
import { ExtendKeyDto } from '../dto/requests/extend-key.dto';
import { ChangeServerDto } from '../dto/requests/change-server.dto';
import { CreateKeyBody } from '../dto/requests/create-key.body';
import { KeyIdDto } from '../dto/requests/key-id.dto';
import { CreateAccountDto } from '../dto/requests/create-account.dto';

@Controller()
@UseGuards(AuthGuard)
export class ApiController {
  constructor(
    private readonly authService: AuthService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Public()
  @Post('login-by-telegram')
  loginByTelegram(@Body() body: LoginDto) {
    return this.authService.loginByTelegram(body.key);
  }

  @Get('users/me')
  GetUsersMe(@UserId() userId: string) {
    return this.authService.getUser(userId);
  }

  @Get('currency-price')
  async getCurrencyPrice() {
    const payload = await this.transactionsService.getCurrencyPrice();
    return new DataResponse(payload);
  }

  @Post('tariffs')
  tariffs(@Body() body: GetTariffsDto) {
    return this.authService.getTariffs(body);
  }

  @Post('extend-key')
  extendKey(@UserId() userId: string, @Body() body: ExtendKeyDto) {
    return this.authService.extendKey(userId, body);
  }

  @Post('servers')
  getServers() {
    return this.authService.getServers();
  }

  @Post('change-server')
  changeServer(@UserId() userId: string, @Body() body: ChangeServerDto) {
    return this.authService.changeServer(userId, body);
  }

  @Post('change-auto-renew')
  changeAutoRenew(@UserId() userId: string, @Body() body: KeyIdDto) {
    return this.authService.changeAutoRenew(userId, body);
  }

  @Post('create-key')
  createKey(@UserId() userId: string, @Body() body: CreateKeyBody) {
    return this.authService.createKey(userId, body);
  }

  @Post('delete-key')
  deleteKey(@UserId() userId: string, @Body() body: KeyIdDto) {
    return this.authService.deleteKey(userId, body);
  }

  @Get('ref-info')
  getRefInfo(@UserId() userId: string) {
    return this.authService.getRefInfo(userId);
  }

  @Public()
  @Post('create-account')
  createAccount(@Body() body: CreateAccountDto) {
    return this.authService.createAccount(body);
  }

  @Public()
  @Get('keys-info/:keyId')
  async getKeyInfo(@Param('keyId') keyId: string, @Res() res: Response) {
    const result = await this.authService.getKeyInfo(keyId);
    if (!result) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('subscription-userinfo', result.userinfo);
    return res.send(result.body);
  }

  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('keys-redirect/key/:keyId')
  getHappRedirectByKey(@Param('keyId') keyId: string, @Res() res: Response) {
    const subUrl = `https://passimx.com/8721280199/keys-info/${keyId}`;
    const targetDeeplink = `incy://add/${subUrl}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Opening INCY...</title>
        <script>
          window.onload = function() {
            window.location.href = "${targetDeeplink}";
            setTimeout(function() {
              document.getElementById('fallback').style.display = 'block';
            }, 1000);
          }
        </script>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding-top: 100px; color: #333; }
          .btn { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
        </style>
      </head>
      <body>
        <p>Перенаправление в приложение INCY...</p>
        <div id="fallback" style="display:none;">
          <p>Если приложение не открылось автоматически, нажмите кнопку ниже:</p>
          <a href="${targetDeeplink}" class="btn">Открыть INCY</a>
        </div>
      </body>
      </html>
    `;
    return res.send(html);
  }
}
