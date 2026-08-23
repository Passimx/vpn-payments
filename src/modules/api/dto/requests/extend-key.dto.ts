import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class ExtendKeyDto {
  @IsUUID()
  readonly keyId: string;

  @IsUUID()
  readonly tariffId: string;

  @IsString()
  @IsNotEmpty()
  readonly userId: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  readonly seqno: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly promoCode?: string;
}
