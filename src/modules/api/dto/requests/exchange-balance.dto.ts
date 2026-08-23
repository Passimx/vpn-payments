import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CurrencyEnum } from '../../../transactions/types/currency.enum';
import {
  precision,
  scale,
} from '../../../database/entities/balance-account.entity';

export class ExchangeBalanceDto {
  @IsString()
  @IsNotEmpty()
  readonly userId: string;

  @IsNumber()
  @Max(10 ** (precision - scale))
  @Min(0.1 ** scale)
  readonly amountFrom: number;

  @IsEnum(CurrencyEnum)
  readonly from: CurrencyEnum;

  @IsEnum(CurrencyEnum)
  readonly to: CurrencyEnum;

  @IsNumber()
  @IsInt()
  @Min(1)
  readonly seqno: number;
}
