import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectShelterDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({
    example: 'Registration number could not be confirmed',
    description: 'Optional reason sent to the applicant',
  })
  reason?: string;
}
