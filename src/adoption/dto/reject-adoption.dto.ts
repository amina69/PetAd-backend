import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectAdoptionDto {
  @ApiPropertyOptional({
    description: 'Optional reason for rejecting the adoption request',
    example: 'Incomplete documentation',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Rejection reason cannot exceed 500 characters' })
  reason?: string;
}
