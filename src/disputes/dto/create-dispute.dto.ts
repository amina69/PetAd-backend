import { IsString, IsEnum, IsOptional, IsArray, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeReason } from '@prisma/client';

export class CreateDisputeDto {
  @ApiProperty({ description: 'Adoption or custody ID to dispute' })
  @IsString()
  entity: string;

  @ApiProperty({ enum: DisputeReason })
  @IsEnum(DisputeReason)
  reason: DisputeReason;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}
