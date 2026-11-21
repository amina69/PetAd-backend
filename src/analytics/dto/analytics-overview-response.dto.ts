import { ApiProperty } from '@nestjs/swagger';

export class DailyMetricsDto {
  @ApiProperty({
    description: 'Date in UTC (YYYY-MM-DD)',
    example: '2026-11-01',
  })
  date: string;

  @ApiProperty({
    description: 'Count of new users registered on this date (UTC)',
    example: 5,
  })
  newUsers: number;

  @ApiProperty({
    description: 'Count of new pet listings created on this date (UTC)',
    example: 3,
  })
  listings: number;

  @ApiProperty({
    description: 'Count of adoption requests submitted on this date (UTC)',
    example: 8,
  })
  requests: number;

  @ApiProperty({
    description: 'Count of adoptions completed on this date (UTC)',
    example: 2,
  })
  completions: number;

  @ApiProperty({
    description: 'Count of active custodies started on this date (UTC)',
    example: 1,
  })
  activeCustody: number;

  @ApiProperty({
    description:
      'Dispute rate for this date (disputed / total escrows, 0 if no escrows)',
    example: 0.05,
  })
  disputeRate: number;

  @ApiProperty({
    description:
      'Total escrow volume funded/created on this date in XLM/USD (UTC)',
    example: 500.0,
  })
  escrowVolume: number;
}

export class MetricsTotalsDto {
  @ApiProperty({
    description: 'Sum of new users across the entire date range',
    example: 35,
  })
  newUsers: number;

  @ApiProperty({
    description: 'Sum of listings created across the entire date range',
    example: 21,
  })
  listings: number;

  @ApiProperty({
    description:
      'Sum of adoption requests submitted across the entire date range',
    example: 56,
  })
  requests: number;

  @ApiProperty({
    description: 'Sum of adoptions completed across the entire date range',
    example: 14,
  })
  completions: number;

  @ApiProperty({
    description: 'Sum of active custodies started across the entire date range',
    example: 7,
  })
  activeCustody: number;

  @ApiProperty({
    description:
      'Sum of daily dispute rates across the series (totals equal the sum of the series)',
    example: 0.35,
  })
  disputeRate: number;

  @ApiProperty({
    description: 'Sum of escrow volume across the entire date range',
    example: 3500.0,
  })
  escrowVolume: number;
}

export class AnalyticsOverviewResponseDto {
  @ApiProperty({
    description:
      'Consistent time zone for all intervals and buckets (always UTC)',
    example: 'UTC',
  })
  timeZone: string;

  @ApiProperty({
    description: 'UTC start timestamp of the requested interval',
    example: '2026-11-01T00:00:00.000Z',
  })
  from: string;

  @ApiProperty({
    description: 'UTC end timestamp of the requested interval',
    example: '2026-11-20T23:59:59.999Z',
  })
  to: string;

  @ApiProperty({
    description: 'Bucket granularity of the time series',
    example: 'day',
  })
  granularity: string;

  @ApiProperty({
    description:
      'Aggregated totals across the period (equal to the sum of the series)',
    type: MetricsTotalsDto,
  })
  totals: MetricsTotalsDto;

  @ApiProperty({
    description:
      'Daily time series covering every single day in range with zeros for empty days',
    type: [DailyMetricsDto],
  })
  series: DailyMetricsDto[];
}
