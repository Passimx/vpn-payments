import { Body, Controller, Post } from '@nestjs/common';
import { WechatService } from './wechat.service';
import type { InvoiceCallbackType } from './types/invoice-callback.type';

@Controller('wechat')
export class WechatController {
  constructor(private wechatService: WechatService) {}

  @Post('invoice/callback')
  public invoiceCallback(@Body() body: InvoiceCallbackType) {
    return this.wechatService.invoiceCallback(body);
  }
}
