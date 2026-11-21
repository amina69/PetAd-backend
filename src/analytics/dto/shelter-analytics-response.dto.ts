import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RatingSummaryMetricsDto {
  @ApiPropertyOptional({
    description: 'Average rating score (1-5 scale) or null if suppressed',
    example: 4.5,
    nullable: true,
  })
  average: number | null;

  @ApiProperty({
    description: 'Number of completed agreements contributing to ratings',
    example: 12,
  })
  count: number;
}

export class PlatformMedianMetricsDto {
  @ApiPropertyOptional({
    description: 'Platform median time-to-adoption in days',
    example: 14.5,
    nullable: true,
  })
  timeToAdoptionDays: number | null;

  @ApiPropertyOptional({
    description: 'Platform median approval response time in hours',
    example: 6.2,
    nullable: true,
  })
  approvalResponseTimeHours: number | null;

  @ApiPropertyOptional({
    description: 'Platform median dispute rate',
    example: 0.02,
    nullable: true,
  })
  disputeRate: number | null;

  @ApiPropertyOptional({
    description: 'Platform median rating average',
    example: 4.8,
    nullable: true,
  })
  ratingAverage: number | null;
}

export class ShelterMetricsComparisonDto {
  @ApiProperty({
    description: 'Comparison metrics against the platform median (admins only)',
    type: PlatformMedianMetricsDto,
  })
  platformMedian: PlatformMedianMetricsDto;
}

export class ShelterMetricsSampleSizesDto {
  @ApiProperty({ description: 'Total listings count', example: 10 })
  listings: number;

  @ApiProperty({ description: 'Completed adoptions count', example: 7 })
  completedAdoptions: number;

  @ApiProperty({ description: 'Reviewed adoption requests count', example: 15 })
  reviewedRequests: number;

  @ApiProperty({ description: 'Total escrows count', example: 8 })
  escrows: number;

  @ApiProperty({ description: 'Rating records count', example: 12 })
  ratings: number;
}

export class ShelterMetricsSuppressedDto {
  @ApiProperty({
    description: 'Whether time-to-adoption is suppressed due to small sample',
    example: false,
  })
  timeToAdoption: boolean;

  @ApiProperty({
    description:
      'Whether approval response time is suppressed due to small sample',
    example: false,
  })
  approvalResponseTime: boolean;

  @ApiProperty({
    description: 'Whether dispute rate is suppressed due to small sample',
    example: false,
  })
  disputeRate: boolean;

  @ApiProperty({
    description: 'Whether rating summary is suppressed due to small sample',
    example: false,
  })
  ratingSummary: boolean;
}

export class ShelterAnalyticsResponseDto {
  @ApiProperty({ description: 'ID of the shelter', example: 'shelter-123' })
  shelterId: string;

  @ApiProperty({
    description: 'Total listings created by the shelter',
    example: 10,
  })
  listings: number;

  @ApiPropertyOptional({
    description: 'Average time-to-adoption in days (null if suppressed)',
    example: 12.5,
    nullable: true,
  })
  timeToAdoption: number | null;

  @ApiPropertyOptional({
    description: 'Average time-to-adoption in days (alias for timeToAdoption)',
    example: 12.5,
    nullable: true,
  })
  timeToAdoptionDays: number | null;

  @ApiPropertyOptional({
    description: 'Average approval response time in hours (null if suppressed)',
    example: 4.5,
    nullable: true,
  })
  approvalResponseTime: number | null;

  @ApiPropertyOptional({
    description:
      'Average approval response time in hours (alias for approvalResponseTime)',
    example: 4.5,
    nullable: true,
  })
  approvalResponseTimeHours: number | null;

  @ApiPropertyOptional({
    description:
      'Dispute rate (disputed escrows / total escrows, null if suppressed)',
    example: 0.03,
    nullable: true,
  })
  disputeRate: number | null;

  @ApiPropertyOptional({
    description: 'Rating summary (average null if suppressed)',
    type: RatingSummaryMetricsDto,
    nullable: true,
  })
  ratingSummary: RatingSummaryMetricsDto | null;

  @ApiProperty({
    description: 'Sample sizes for each metric category',
    type: ShelterMetricsSampleSizesDto,
  })
  sampleSizes: ShelterMetricsSampleSizesDto;

  @ApiProperty({
    description: 'Suppression flags for metrics with fewer than N cases',
    type: ShelterMetricsSuppressedDto,
  })
  suppressed: ShelterMetricsSuppressedDto;

  @ApiPropertyOptional({
    description:
      'Platform median comparison (included only for admins/analysts)',
    type: ShelterMetricsComparisonDto,
  })
  comparison?: ShelterMetricsComparisonDto;
}
