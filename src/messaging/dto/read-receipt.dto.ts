import { IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReadReceiptDto {
  @ApiPropertyOptional({
    description:
      'Last message read. When omitted the newest message in the conversation is used.',
  })
  @IsOptional()
  @IsString()
  messageId?: string;
}

export class ReportConversationDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @Length(1, 500)
  reason: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  details?: string;
}
