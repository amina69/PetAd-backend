import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PetStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for updating pet status
 * new
 * one
 */
export class UpdatePetStatusDto {
  @ApiProperty({
    enum: Object.values(PetStatus),
    description: 'New status for the pet',
    example: 'PENDING',
  })
  @IsEnum(PetStatus)
  @IsNotEmpty()
  newStatus: PetStatus;

  @ApiPropertyOptional({
    description: 'Reason for status change (e.g., "Return from adoption")',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
