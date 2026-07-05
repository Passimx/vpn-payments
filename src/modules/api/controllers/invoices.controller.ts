import { Body, Controller, Param, Post } from '@nestjs/common';
import { InvoicesService } from '../services/invoices.service';
import { GetInvoiceDto } from '../dto/requests/get-invoice.dto';
import { GetTonInvoice } from '../dto/requests/get-ton.invoice';

@Controller('invoices')
// @UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('sber/:id')
  getSberInvoice(@Param('id') userId: string, @Body() body: GetInvoiceDto) {
    return this.invoicesService.getSberInvoice(userId, body.amount);
  }

  @Post('wechat')
  getWechatInvoice(@Param('id') userId: string, @Body() body: GetInvoiceDto) {
    return this.invoicesService.getWechatInvoice(userId, body.amount);
  }

  @Post('ton')
  getTonInvoice(@Param('id') userId: string, @Body() body: GetTonInvoice) {
    return this.invoicesService.getTonInvoice(
      userId,
      body.amount,
      body.currency,
      body.app,
    );
  }
}
