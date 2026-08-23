import { IsInt, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateKeyDto {
  @IsUUID()
  readonly userId: string;

  @IsUUID()
  readonly tariffId: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  readonly seqno: number;

  protocol?: string = 'xray';

  readonly promoCode?: string;
}
