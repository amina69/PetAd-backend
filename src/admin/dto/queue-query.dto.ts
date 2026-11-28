import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum QueuePriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class QueueQueryDto {
  @ApiPropertyOptional({ description: 'Filter by assignee admin ID' })
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional({ description: 'Filter items older than specified days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  olderThanDays?: number;

  @ApiPropertyOptional({ description: 'Filter by priority', enum: QueuePriority })
  @IsOptional()
  @IsEnum(QueuePriority)
  priority?: QueuePriority;
}
