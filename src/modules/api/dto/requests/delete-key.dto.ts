import { IsUUID } from 'class-validator';

export class DeleteKeyDto {
  @IsUUID()
  readonly keyId: string;
}
