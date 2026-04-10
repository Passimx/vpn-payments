import { Body, Controller, Post } from '@nestjs/common';
import { WechatService } from './wechat.service';
import type { InvoiceCallbackType } from './types/invoice-callback.type';

@Controller('wechat')
export class WechatController {
  constructor(private wechatService: WechatService) {}

  @Post('invoice/callback')
  public async invoiceCallback(@Body() body: InvoiceCallbackType) {
    await this.wechatService.invoiceCallback(body);

    return {
      code: 'SUCCESS',
      message: 'SUCCESS',
    };
  }
}
