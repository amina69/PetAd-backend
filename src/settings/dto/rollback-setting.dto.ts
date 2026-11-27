import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RollbackSettingDto {
  @ApiProperty({ description: 'Version number to roll back to' })
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  version: number;

  @ApiPropertyOptional({ description: 'Reason for rolling back' })
  @IsString()
  @IsOptional()
  reason?: string;
}
