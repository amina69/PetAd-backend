import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSettingDto {
  @ApiProperty({ description: 'New value for the setting' })
  @IsNotEmpty()
  value: any;

  @ApiPropertyOptional({ description: 'Reason for changing the setting' })
  @IsString()
  @IsOptional()
  reason?: string;
}
