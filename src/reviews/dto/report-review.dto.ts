import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReportReviewDto {
  @ApiProperty({
    minLength: 10,
    description: 'Why the review should be reviewed.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
