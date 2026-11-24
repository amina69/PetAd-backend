import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectShelterDto {
  @ApiPropertyOptional({
    example: 'Registration number could not be verified',
    description: 'Reason shown to the shelter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
