import { IsUUID } from 'class-validator';

export class ChangeServerDto {
  @IsUUID()
  readonly keyId: string;

  @IsUUID()
  readonly serverId: string;
}
