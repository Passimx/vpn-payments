import { CurrencyEnum } from '../../transactions/types/currency.enum';
import { AppWalletEnum } from '../../ton/enums/app-wallet.enum';

export type CreateTonInvoiceType = {
  amount: number;
  userId: string;
  currency: CurrencyEnum.TON | CurrencyEnum.USD;
  app: AppWalletEnum;
};
