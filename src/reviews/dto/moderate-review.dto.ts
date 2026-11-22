import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ModerateReviewDto {
  @ApiProperty({
    minLength: 10,
    description: 'Moderation reason shared with the review author.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
