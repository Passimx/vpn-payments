import { IsString } from 'class-validator';

export class GetTariffsDto {
  @IsString()
  readonly kind: string;
}
