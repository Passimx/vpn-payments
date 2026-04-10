import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WechatService } from './wechat.service';
import type { InvoiceCallbackType } from './types/invoice-callback.type';

@Controller('wechat')
export class WechatController {
  constructor(private wechatService: WechatService) {}

  @Post('invoice/callback')
  @HttpCode(200)
  public async invoiceCallback(@Body() body: InvoiceCallbackType) {
    await this.wechatService.invoiceCallback(body);

    return {
      code: 'SUCCESS',
      message: 'OK',
    };
  }
}
