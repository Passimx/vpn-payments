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

  @IsUUID()
  readonly userId: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  readonly seqno: number;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  readonly promoCode?: string;
}
