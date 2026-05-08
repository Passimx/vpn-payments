import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { InvoicesService } from '../services/invoices.service';
import { UserId } from '../../../common/guards/user.decorator';
import { GetInvoiceDto } from '../dto/requests/get-invoice.dto';
import { GetTonInvoice } from '../dto/requests/get-ton.invoice';

@Controller('invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('sber')
  getSberInvoice(@UserId() userId: string, @Body() body: GetInvoiceDto) {
    return this.invoicesService.getSberInvoice(userId, body.amount);
  }

  @Post('wechat')
  getWechatInvoice(@UserId() userId: string, @Body() body: GetInvoiceDto) {
    return this.invoicesService.getWechatInvoice(userId, body.amount);
  }

  @Post('ton')
  getTonInvoice(@UserId() userId: string, @Body() body: GetTonInvoice) {
    return this.invoicesService.getTonInvoice(
      userId,
      body.amount,
      body.currency,
      body.app,
    );
  }
}
