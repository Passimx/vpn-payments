import { IsUUID } from 'class-validator';

export class ExtendKeyDto {
  @IsUUID()
  readonly keyId: string;

  @IsUUID()
  readonly tariffId: string;

  @IsUUID()
  readonly userId: string;
}
