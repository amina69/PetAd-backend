import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFeatureFlagDto {
  @ApiProperty({
    example: 'new-adoption-flow',
    description: 'Stable key used by clients to evaluate the flag.',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/, {
    message:
      'key must start with a lowercase letter and contain only lowercase letters, numbers, dots, underscores or hyphens (2-64 characters)',
  })
  key!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ApiPropertyOptional({ enum: UserRole, isArray: true, default: [] })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  targetRoles?: UserRole[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
