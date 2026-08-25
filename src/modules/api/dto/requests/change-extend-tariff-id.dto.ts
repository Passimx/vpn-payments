import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ChangeExtendTariffIdDto {
  @IsUUID()
  @IsOptional()
  readonly tariffId: string;

  @IsUUID()
  readonly keyId: string;

  @IsString()
  @IsNotEmpty()
  readonly userId: string;
}
