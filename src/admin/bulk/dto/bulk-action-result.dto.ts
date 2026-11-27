import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkActionResultDto {
  @ApiProperty() id!: string;

  @ApiProperty() success!: boolean;

  @ApiPropertyOptional({ description: 'Failure reason when success is false.' })
  error?: string;
}

export class BulkActionResponseDto {
  @ApiProperty({ type: [BulkActionResultDto] })
  results!: BulkActionResultDto[];

  @ApiProperty() succeeded!: number;

  @ApiProperty() failed!: number;
}
