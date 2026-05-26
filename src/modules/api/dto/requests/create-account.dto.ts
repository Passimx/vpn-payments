import { IsString } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  readonly languageCode: string;
}
