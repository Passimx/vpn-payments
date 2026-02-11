import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTariffDto {
  @IsString()
  @MaxLength(128)
  readonly name: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  readonly trafficGb: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly expirationDays: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  readonly price: number;

  @IsBoolean()
  @IsOptional()
  readonly isUnlimited?: boolean;

  @IsBoolean()
  @IsOptional()
  readonly active?: boolean;
}
