import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeEntityType, DisputeReason, DisputeStatus } from '@prisma/client';

export const DISPUTE_SORT_FIELDS = ['createdAt', 'updatedAt', 'status'] as const;
export const DISPUTE_SORT_ORDERS = ['asc', 'desc'] as const;

export type DisputeSortField = (typeof DISPUTE_SORT_FIELDS)[number];
export type DisputeSortOrder = (typeof DISPUTE_SORT_ORDERS)[number];

export class ListDisputesDto {
  @ApiPropertyOptional({ enum: DisputeStatus })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;

  @ApiPropertyOptional({ enum: DisputeReason })
  @IsOptional()
  @IsEnum(DisputeReason)
  reason?: DisputeReason;

  @ApiPropertyOptional({ enum: DisputeEntityType })
  @IsOptional()
  @IsEnum(DisputeEntityType)
  entityType?: DisputeEntityType;

  @ApiPropertyOptional({
    description: 'Only disputes created on or after this ISO date.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Only disputes created on or before this ISO date.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

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
  limit?: number = 20;

  @ApiPropertyOptional({ enum: DISPUTE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(DISPUTE_SORT_FIELDS)
  sort?: DisputeSortField = 'createdAt';

  @ApiPropertyOptional({ enum: DISPUTE_SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(DISPUTE_SORT_ORDERS)
  order?: DisputeSortOrder = 'desc';
}

export class AdminListDisputesDto extends ListDisputesDto {
  @ApiPropertyOptional({
    description:
      'Restrict to one assignee. Accepts `me`, `unassigned`, or a user UUID.',
    example: 'unassigned',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(me|unassigned|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, {
    message: 'assignee must be `me`, `unassigned`, or a user UUID',
  })
  assignee?: string;

  @ApiPropertyOptional({
    description: 'Minimum dispute age in days (time since creation).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAgeDays?: number;

  @ApiPropertyOptional({
    description: 'Maximum dispute age in days (time since creation).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAgeDays?: number;
}
