import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServerDto {
  @IsString()
  @MaxLength(255)
  readonly host: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9_-]+$/)
  readonly code: string;

  @IsBoolean()
  @IsOptional()
  readonly canDefaultCreateKey?: boolean;

  @IsBoolean()
  @IsOptional()
  readonly canCreateKey?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  readonly port?: number;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  readonly forCascadeInboundTag?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  readonly cdnDomain?: string;
}
