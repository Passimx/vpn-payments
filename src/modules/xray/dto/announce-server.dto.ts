import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

function asArray(value: unknown): unknown[] | undefined {
  if (value == null || value === '') return undefined;
  return Array.isArray(value) ? value : [value];
}

export class AnnounceServerDto {
  @IsOptional()
  @IsIn(['send'])
  readonly confirm?: 'send';

  @IsOptional()
  @IsBoolean()
  readonly dryRun?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(3500)
  readonly text?: string;

  @IsOptional()
  @Transform(({ value }) => asArray(value)?.map((item) => Number(item)))
  @IsArray()
  @IsInt({ each: true })
  readonly telegramId?: number[];

  @IsOptional()
  @Transform(({ value }) => asArray(value))
  @IsArray()
  @IsString({ each: true })
  readonly keyId?: string[];

  @IsOptional()
  @Transform(({ value }) => asArray(value))
  @IsArray()
  @IsString({ each: true })
  readonly userId?: string[];
}
