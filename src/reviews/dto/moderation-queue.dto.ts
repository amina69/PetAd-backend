import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewReportStatus } from '@prisma/client';

export class ModerationQueueDto {
  @ApiPropertyOptional({ enum: ReviewReportStatus, default: 'OPEN' })
  @IsOptional()
  @IsEnum(ReviewReportStatus)
  status?: ReviewReportStatus = ReviewReportStatus.OPEN;

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
}
