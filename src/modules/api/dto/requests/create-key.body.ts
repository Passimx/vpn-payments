import { IsUUID } from 'class-validator';

export class CreateKeyBody {
  @IsUUID()
  readonly tariffId: string;
}
