import { CurrencyEnum } from '../../../transactions/types/currency.enum';

export class TransferDto {
  readonly userId: string;

  readonly amount: number;

  readonly currency: CurrencyEnum;

  readonly recipient: string;

  readonly comment?: string;
}
