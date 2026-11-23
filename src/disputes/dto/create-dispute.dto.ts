import {
  IsEnum,
  IsString,
  MinLength,
  IsOptional,
  IsArray,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeReason } from '@prisma/client';

export class CreateDisputeDto {
  @ApiProperty({ enum: DisputeReason })
  @IsEnum(DisputeReason)
  reason: DisputeReason;

  @ApiProperty({ minLength: 50 })
  @IsString()
  @MinLength(50)
  description: string;

  @ApiProperty({ description: 'ID of the adoption or custody being disputed' })
  @IsUUID()
  entity: string;

  @ApiPropertyOptional({ type: [String], description: 'IDs of pre-uploaded attachments' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
