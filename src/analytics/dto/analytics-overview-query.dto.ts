import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum AnalyticsGranularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

/**
 * Query parameters for GET /admin/analytics/overview
 *
 * All dates are parsed and processed strictly in UTC to ensure consistent time zones.
 * - `from`: Start of the range (UTC). If a date string like '2026-11-01' is provided, it is treated as 2026-11-01T00:00:00.000Z.
 * - `to`: End of the range (UTC). If a date string like '2026-11-07' is provided, it is treated as 2026-11-07T23:59:59.999Z.
 * - `granularity`: Bucket size for the time series. Defaults to 'day'.
 */
export class AnalyticsOverviewQueryDto {
  @ApiPropertyOptional({
    description:
      'Start date in UTC (ISO string or YYYY-MM-DD). Defaults to 30 days before "to".',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'End date in UTC (ISO string or YYYY-MM-DD). Defaults to current date in UTC.',
    example: '2026-11-20',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Time bucket granularity for the series (default: day). Consistent time series buckets in UTC.',
    enum: AnalyticsGranularity,
    default: AnalyticsGranularity.DAY,
    example: 'day',
  })
  @IsOptional()
  @IsEnum(AnalyticsGranularity)
  granularity?: AnalyticsGranularity = AnalyticsGranularity.DAY;
}
