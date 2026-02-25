import { AdoptionStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class FilterAdoptionsDto {
  @ApiPropertyOptional({
    enum: AdoptionStatus,
    description: 'Filter adoption requests by status',
  })
  @IsOptional()
  @IsEnum(AdoptionStatus)
  status?: AdoptionStatus;

  @ApiPropertyOptional({
    description: 'Filter adoption requests by pet id',
    example: 'pet-123',
  })
  @IsOptional()
  @IsString()
  petId?: string;
}
