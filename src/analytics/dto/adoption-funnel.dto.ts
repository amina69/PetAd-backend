import { ApiProperty } from '@nestjs/swagger';

export class FunnelStageDto {
  @ApiProperty({ example: 'REQUESTED' })
  stage: string;

  @ApiProperty({ example: 100 })
  count: number;

  @ApiProperty({ example: 100, description: 'Percentage of the REQUESTED stage' })
  conversionRate: number;
}

export class DropOffReasonDto {
  @ApiProperty({ example: 'REJECTED' })
  reason: string;

  @ApiProperty({ example: 10 })
  count: number;

  @ApiProperty({ example: 10 })
  rate: number;
}

export class StageMedianDto {
  @ApiProperty({ example: 'REQUESTED' })
  from: string;

  @ApiProperty({ example: 'APPROVED' })
  to: string;

  @ApiProperty({
    example: 1.5,
    nullable: true,
    description: 'Median days between the two stages, computed in SQL',
  })
  medianDays: number | null;
}

export class AdoptionBreakdownDto {
  @ApiProperty({ example: 'DOG' })
  species: string;

  @ApiProperty({ example: 'ADULT' })
  ageBand: string;

  @ApiProperty({ example: 'MEDIUM' })
  size: string;

  @ApiProperty({ example: 10 })
  requested: number;

  @ApiProperty({ example: 4 })
  completed: number;

  @ApiProperty({ example: 40 })
  completionRate: number;
}

export class AdoptionSuccessDto {
  @ApiProperty({ example: 100 })
  completed: number;

  @ApiProperty({ example: 92 })
  successful: number;

  @ApiProperty({
    example: 'Completed and not returned/cancelled within 30 days',
  })
  definition: string;
}

export class AdoptionFunnelDto {
  @ApiProperty({ example: 365 })
  windowDays: number;

  @ApiProperty({
    example: 'Completed and not returned or cancelled within 30 days',
  })
  successDefinition: string;

  @ApiProperty({ type: [FunnelStageDto] })
  stages: FunnelStageDto[];

  @ApiProperty({ type: [DropOffReasonDto] })
  dropOffs: DropOffReasonDto[];

  @ApiProperty({ type: [StageMedianDto] })
  medians: StageMedianDto[];

  @ApiProperty({ type: [AdoptionBreakdownDto] })
  breakdown: AdoptionBreakdownDto[];

  @ApiProperty({ type: AdoptionSuccessDto })
  success: AdoptionSuccessDto;
}
