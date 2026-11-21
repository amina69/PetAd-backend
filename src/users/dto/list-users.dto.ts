import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../common/enums';
import { UserStatus } from '@prisma/client';

export class ListUsersDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Search by email or name (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Sort field and order, e.g. createdAt:desc or createdAt:asc' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^(createdAt|updatedAt|email|firstName|lastName|role|status|trustScore)(:(asc|desc))?$/)
  sort?: string;
}
