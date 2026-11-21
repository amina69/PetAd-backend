import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectionStateDto {
  @ApiProperty({ example: 'daily_aggregates' })
  key: string;

  @ApiPropertyOptional({ nullable: true })
  lastProcessedAt: Date | null;

  @ApiProperty()
  lastRunAt: Date;

  @ApiProperty({ example: 42 })
  rowCount: number;

  @ApiPropertyOptional({ nullable: true, example: 120 })
  refreshLagSeconds: number | null;

  @ApiProperty({ example: 300 })
  refreshIntervalSeconds: number;
}
