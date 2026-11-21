import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 3650, default: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  windowDays?: number = 365;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 3650,
    default: 30,
    description: 'Days without completion before a request is counted as expired',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiredAfterDays?: number = 30;
}
