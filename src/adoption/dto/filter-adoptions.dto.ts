import { IsOptional, IsEnum, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdoptionStatus } from '@prisma/client';

export class FilterAdoptionsDto {
  @ApiPropertyOptional({ enum: AdoptionStatus, description: 'Filter by adoption status' })
  @IsOptional()
  @IsEnum(AdoptionStatus)
  status?: AdoptionStatus;

  @ApiPropertyOptional({ description: 'Filter by pet ID' })
  @IsOptional()
  @IsUUID()
  petId?: string;
}
