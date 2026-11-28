import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ReportActionType {
  DISMISS = 'DISMISS',
  WARN = 'WARN',
  HIDE_CONTENT = 'HIDE_CONTENT',
  SUSPEND_USER = 'SUSPEND_USER',
}

export class TriageReportDto {
  @ApiProperty({ enum: ReportActionType, description: 'Triage action to take on the report' })
  @IsEnum(ReportActionType)
  @IsNotEmpty()
  action: ReportActionType;

  @ApiPropertyOptional({ description: 'Optional notes or warning message for the action' })
  @IsString()
  @IsOptional()
  notes?: string;
}
