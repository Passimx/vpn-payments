import { IsInt } from 'class-validator';

export class GetInvoiceDto {
  @IsInt()
  amount: number;
}
