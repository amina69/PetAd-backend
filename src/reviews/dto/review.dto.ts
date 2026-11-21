import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewReportReason } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const PLAIN_TEXT = /^[^<>]*$/;

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ maxLength: 80 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(PLAIN_TEXT, { message: 'title must be plain text' })
  title!: string;

  @ApiProperty({ minLength: 20, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  @Matches(PLAIN_TEXT, { message: 'body must be plain text' })
  body!: string;
}

export class CreateReviewResponseDto {
  @ApiProperty({ maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Matches(PLAIN_TEXT, { message: 'body must be plain text' })
  body!: string;
}

export class CreateReviewReportDto {
  @ApiProperty({ enum: ReviewReportReason })
  @IsEnum(ReviewReportReason)
  reason!: ReviewReportReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  @Matches(PLAIN_TEXT, { message: 'details must be plain text' })
  details?: string;
}

export class ListReviewsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: ['recent', 'highest', 'lowest'],
    default: 'recent',
  })
  @IsOptional()
  @IsEnum(['recent', 'highest', 'lowest'])
  sort?: 'recent' | 'highest' | 'lowest' = 'recent';

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
