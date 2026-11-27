import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegionMetricsDto {
  @ApiProperty({
    description: 'Region name or identifier (State or City, State)',
    example: 'California',
  })
  region: string;

  @ApiProperty({
    description: 'State or province name/code',
    example: 'CA',
  })
  state: string;

  @ApiPropertyOptional({
    description: 'City name if city bucket, or null if state bucket',
    example: 'San Francisco',
    nullable: true,
  })
  city: string | null;

  @ApiProperty({
    description: 'Pet supply count (listings available in this region)',
    example: 25,
  })
  supply: number;

  @ApiProperty({
    description: 'Adoption demand count (requests for pets in this region)',
    example: 40,
  })
  demand: number;

  @ApiProperty({
    description: 'Completed adoptions in this region',
    example: 18,
  })
  adoptionsCompleted: number;

  @ApiProperty({
    description:
      'Total activity records (must be >= 5 to satisfy k-anonymity; smaller regions are merged or omitted)',
    example: 65,
  })
  totalRecords: number;

  @ApiProperty({
    description: 'Supply-to-demand ratio (supply / max(demand, 1))',
    example: 0.63,
  })
  supplyToDemandRatio: number;

  @ApiProperty({
    description:
      'Whether this region is under-served (demand significantly exceeds supply)',
    example: true,
  })
  underServed: boolean;

  @ApiPropertyOptional({
    description:
      'Approximate region centroid latitude (rounded to at most 1 decimal place, ~11 km precision)',
    example: 37.8,
    nullable: true,
  })
  approximateLatitude?: number | null;

  @ApiPropertyOptional({
    description:
      'Approximate region centroid longitude (rounded to at most 1 decimal place, ~11 km precision)',
    example: -122.4,
    nullable: true,
  })
  approximateLongitude?: number | null;
}

export class AdoptionDistanceDistributionDto {
  @ApiProperty({
    description: 'Distance band range label',
    example: '0-10 km',
  })
  band: string;

  @ApiProperty({
    description:
      'Number of completed adoptions falling within this distance band',
    example: 12,
  })
  count: number;

  @ApiProperty({
    description: 'Percentage of total measured adoptions (0-100)',
    example: 40.0,
  })
  percentage: number;
}

export class GeoAnalyticsResponseDto {
  @ApiProperty({
    description: 'Minimum cell size enforced for k-anonymity (>= 5)',
    example: 5,
  })
  kAnonymityMinCellSize: number;

  @ApiProperty({
    description: 'Total number of regions meeting the k-anonymity threshold',
    example: 8,
  })
  totalRegions: number;

  @ApiProperty({
    description:
      'Aggregated region metrics. Every returned region has totalRecords >= 5.',
    type: [RegionMetricsDto],
  })
  regions: RegionMetricsDto[];

  @ApiPropertyOptional({
    description:
      'Aggregated bucket for regions with fewer than 5 records merged together',
    type: RegionMetricsDto,
    nullable: true,
  })
  mergedOtherRegions: RegionMetricsDto | null;

  @ApiProperty({
    description: 'Under-served regions where demand exceeds supply (gap > 0)',
    type: [RegionMetricsDto],
  })
  underServedRegions: RegionMetricsDto[];

  @ApiProperty({
    description:
      'Adoption distance distribution across standard distance bands',
    type: [AdoptionDistanceDistributionDto],
  })
  distanceDistribution: AdoptionDistanceDistributionDto[];
}
