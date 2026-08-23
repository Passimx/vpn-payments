import { CurrencyEnum } from '../../../transactions/types/currency.enum';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  precision,
  scale,
} from '../../../database/entities/balance-account.entity';

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  readonly userId: string;

  @IsNumber()
  @Max(10 ** (precision - scale))
  @Min(0.1 ** scale)
  readonly amount: number;

  @IsEnum(CurrencyEnum)
  readonly currency: CurrencyEnum;

  @IsString()
  @IsNotEmpty()
  readonly recipient: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  readonly seqno: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly comment?: string;
}
