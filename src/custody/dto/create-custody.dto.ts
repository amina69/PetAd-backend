import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class CreateCustodyDto {
  @IsUUID()
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'UUID of the pet to request custody for',
  })
  petId: string;

  @IsDateString()
  @ApiProperty({
    example: '2024-12-25T00:00:00.000Z',
    description: 'Start date of the custody period (must be in the future)',
  })
  startDate: string;

  @IsInt()
  @Min(1)
  @Max(90)
  @ApiProperty({
    example: 14,
    description: 'Duration of custody in days (minimum 1, maximum 90)',
    minimum: 1,
    maximum: 90,
  })
  durationDays: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    example: 100.0,
    description: 'Optional refundable deposit amount',
    required: false,
  })
  depositAmount?: number;
}
