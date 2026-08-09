import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { Public } from '../../../common/guards/public.decorator';
import { Envs } from '../../../common/env/envs';
import { I18nService } from '../../i18n/i18n.service';
import { EntityManager } from 'typeorm';
import { UserKeyEntity } from '../../database/entities/user-key.entity';

@Controller()
export class ApiController {
  constructor(
    private readonly authService: AuthService,
    private readonly i18nService: I18nService,
    private readonly em: EntityManager,
  ) {}

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
