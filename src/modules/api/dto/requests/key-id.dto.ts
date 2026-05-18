import { IsUUID } from 'class-validator';

export class KeyIdDto {
  @IsUUID()
  readonly keyId: string;
}
