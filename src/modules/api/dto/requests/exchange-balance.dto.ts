import { PriceType } from '../../../transactions/types/price.type';

export class ExchangeBalanceDto {
  readonly userId: string;

  readonly amountFrom: number;

  readonly from: keyof PriceType;

  readonly to: keyof PriceType;

  readonly seqno: number;
}
