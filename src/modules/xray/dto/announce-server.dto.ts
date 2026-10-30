import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

function asArray(value: unknown): unknown[] | undefined {
  if (value == null || value === '') return undefined;
  if (!Array.isArray(value)) return [value];
  const items: unknown[] = [];
  for (const item of value as unknown[]) items.push(item);
  return items;
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
  @Transform(({ value }): number[] | undefined =>
    asArray(value)?.map((item) => Number(item)),
  )
  @IsArray()
  @IsInt({ each: true })
  readonly telegramId?: number[];

  @IsOptional()
  @Transform(({ value }): string[] | undefined =>
    asArray(value)?.map((item) => String(item)),
  )
  @IsArray()
  @IsString({ each: true })
  readonly keyId?: string[];

  @IsOptional()
  @Transform(({ value }): string[] | undefined =>
    asArray(value)?.map((item) => String(item)),
  )
  @IsArray()
  @IsString({ each: true })
  readonly userId?: string[];
}
