import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @IsString()
  revieweeId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  agreementId?: string;
}

export class ResolveAbuseSignalDto {
  @IsIn(['CONFIRMED', 'DISMISSED'])
  resolution: 'CONFIRMED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  note?: string;
}
