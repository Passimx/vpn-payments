import { IsNumber } from 'class-validator';

export class GetInvoiceDto {
  @IsNumber()
  amount: number;
}
