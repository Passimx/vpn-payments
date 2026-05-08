import { GetInvoiceDto } from './get-invoice.dto';
import { CurrencyEnum } from '../../../transactions/types/currency.enum';
import { IsEnum } from 'class-validator';
import { AppWalletEnum } from '../../../ton/enums/app-wallet.enum';

export class GetTonInvoice extends GetInvoiceDto {
  @IsEnum(CurrencyEnum)
  currency: CurrencyEnum.TON | CurrencyEnum.TON_USDT;

  @IsEnum(AppWalletEnum)
  app: AppWalletEnum;
}
