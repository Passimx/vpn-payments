import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { Public } from '../../../common/guards/public.decorator';
import { TransactionsService } from '../../transactions/transactions.service';
import { DataResponse } from '../dto/responses/data-response.dto';
import { Envs } from '../../../common/env/envs';
import { I18nService } from '../../i18n/i18n.service';
import { EntityManager } from 'typeorm';
import { UserKeyEntity } from '../../database/entities/user-key.entity';
import { TelegramService } from '../../telegram/telegram-service';

@Controller()
export class ApiController {
  constructor(
    private readonly authService: AuthService,
    private readonly i18nService: I18nService,
    private readonly transactionsService: TransactionsService,
    private readonly em: EntityManager,
  ) {}

  // @Public()
  // @Post('login-by-telegram')
  // loginByTelegram(@Body() body: LoginDto) {
  //   return this.authService.loginByTelegram(body.key);
  // }

  @Public()
  @Get('users/passimx/:id')
  GetUsersMe(@Param('id') userId: string) {
    return this.authService.getUserByPassimxId(userId);
  }

  @Public()
  @Get('currency-price')
  async getCurrencyPrice() {
    const payload = await this.transactionsService.getCurrencyPrice();
    return new DataResponse(payload);
  }

  @Public()
  @Get('apps')
  getApps() {
    return new DataResponse(TelegramService.downloadLinks);
  }

  // @Post('tariffs')
  // tariffs(@Body() body: GetTariffsDto) {
  //   return this.authService.getTariffs(body);
  // }
  //
  // @Post('extend-key')
  // extendKey(@UserId() userId: string, @Body() body: ExtendKeyDto) {
  //   return this.authService.extendKey(userId, body);
  // }
  //
  // @Post('servers')
  // getServers() {
  //   return this.authService.getServers();
  // }
  //
  // @Post('change-auto-renew')
  // changeAutoRenew(@UserId() userId: string, @Body() body: KeyIdDto) {
  //   return this.authService.changeAutoRenew(userId, body);
  // }
  //
  // @Post('create-key')
  // createKey(@UserId() userId: string, @Body() body: CreateKeyBody) {
  //   return this.authService.createKey(userId, body);
  // }
  //
  // @Post('delete-key')
  // deleteKey(@UserId() userId: string, @Body() body: KeyIdDto) {
  //   return this.authService.deleteKey(userId, body);
  // }
  //
  // @Get('ref-info')
  // getRefInfo(@UserId() userId: string) {
  //   return this.authService.getRefInfo(userId);
  // }
  //
  // @Public()
  // @Post('create-account')
  // createAccount(@Body() body: CreateAccountDto) {
  //   return this.authService.createAccount(body);
  // }

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
  @Get('keys-redirect/:app/:keyId')
  async getHappRedirectByKey(
    @Param('app') app: string,
    @Param('keyId') keyId: string,
    @Res() res: Response,
  ) {
    const key = await this.em.findOneOrFail(UserKeyEntity, {
      where: { id: keyId },
      relations: ['user'],
    });
    const lang = key.user.languageCode;

    const subUrl = `${Envs.main.appUrl}/keys-info/${keyId}`;
    const targetDeeplink = `${app}://add/${subUrl}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${app}</title>
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
        <p>${this.i18nService.t(lang, 't17')}...</p>
        <div id="fallback" style="display:none;">
          <p>${this.i18nService.t(lang, 't18')}:</p>
          <a href="${targetDeeplink}" class="btn">${this.i18nService.t(lang, 'open_app_button')}</a>
        </div>
      </body>
      </html>
    `;
    return res.send(html);
  }
}
