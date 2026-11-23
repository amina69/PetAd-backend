import { IsString, MaxLength, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddDisputeCommentDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({ default: false, description: 'Admin-only internal note' })
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
