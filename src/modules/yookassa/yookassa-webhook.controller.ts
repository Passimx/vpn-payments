import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { YooKassaWebhookPayload } from './yookassa-balance.service';
import { YookassaBalanceService } from './yookassa-balance.service';

@Controller('yookassa')
export class YooKassaWebhookController {
  constructor(
    private readonly yookassaBalanceService: YookassaBalanceService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() body: YooKassaWebhookPayload): Promise<void> {
    await this.yookassaBalanceService.handleWebhook(body);
  }
}
