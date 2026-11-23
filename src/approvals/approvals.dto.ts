import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { ApprovalType, ApprovalStatus } from '@prisma/client';

export class CreateApprovalRequestDto {
  @ApiProperty({ enum: ApprovalType })
  @IsEnum(ApprovalType)
  type: ApprovalType;

  @ApiProperty({ description: 'ID of the adoption, custody, or escrow being reviewed' })
  @IsUUID()
  referenceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'ISO datetime when request expires' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class DecideApprovalDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsEnum(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListApprovalsQueryDto {
  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @ApiPropertyOptional({ enum: ApprovalType })
  @IsOptional()
  @IsEnum(ApprovalType)
  type?: ApprovalType;
}
