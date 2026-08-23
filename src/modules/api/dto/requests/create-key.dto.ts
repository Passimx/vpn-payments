import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateKeyDto {
  @IsString()
  @IsNotEmpty()
  readonly userId: string;

  @IsUUID()
  readonly tariffId: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  readonly seqno: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  protocol?: string = 'xray';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly promoCode?: string;
}
