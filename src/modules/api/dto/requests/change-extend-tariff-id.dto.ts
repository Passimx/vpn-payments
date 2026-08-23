import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ChangeExtendTariffIdDto {
  @IsUUID()
  readonly tariffId: string;

  @IsUUID()
  readonly keyId: string;

  @IsString()
  @IsNotEmpty()
  readonly userId: string;
}
