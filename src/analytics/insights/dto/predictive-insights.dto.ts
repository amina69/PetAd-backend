import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PetSpecies } from '@prisma/client';

export enum ConfidenceLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum QualityGrade {
  EXCELLENT = 'EXCELLENT',
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  NEEDS_IMPROVEMENT = 'NEEDS_IMPROVEMENT',
}

export class EstimateAdoptionTimeInputDto {
  @ApiProperty({
    description: 'Species of the pet',
    enum: PetSpecies,
    example: PetSpecies.DOG,
  })
  @IsEnum(PetSpecies)
  species: PetSpecies;

  @ApiPropertyOptional({
    description: 'Age in years or months',
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  age?: number;

  @ApiPropertyOptional({
    description: 'Region (State, City, or Province)',
    example: 'CA',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    description: 'Pet description text',
    example:
      'Playful and friendly golden retriever, fully vaccinated and neutered.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether listing contains photos',
    example: true,
  })
  @IsOptional()
  hasPhoto?: boolean;

  @ApiPropertyOptional({
    description: 'Breed name',
    example: 'Golden Retriever',
  })
  @IsOptional()
  @IsString()
  breed?: string;
}

export class QualityScoreBreakdownDto {
  @ApiProperty({ description: 'Photo score (out of 35)', example: 35 })
  photoScore: number;

  @ApiProperty({
    description: 'Description detail score (out of 35)',
    example: 30,
  })
  descriptionScore: number;

  @ApiProperty({
    description: 'Health and care info score (out of 15)',
    example: 15,
  })
  healthInfoScore: number;

  @ApiProperty({
    description: 'Location and breed completeness score (out of 15)',
    example: 15,
  })
  locationAndBreedScore: number;
}

export class ListingQualityDto {
  @ApiProperty({
    description: 'Overall listing quality score (0-100)',
    example: 85,
  })
  score: number;

  @ApiProperty({
    description: 'Quality grade based on score',
    enum: QualityGrade,
    example: QualityGrade.EXCELLENT,
  })
  grade: QualityGrade;

  @ApiProperty({
    description: 'Breakdown of score by quality dimension',
    type: QualityScoreBreakdownDto,
  })
  breakdown: QualityScoreBreakdownDto;

  @ApiProperty({
    description:
      'Actionable recommended improvements to increase listing appeal',
    example: [
      'Add more detail about daily routine and compatibility with children or other pets.',
    ],
  })
  recommendations: string[];
}

export class PredictionFeaturesDto {
  @ApiProperty({ description: 'Species evaluated', example: 'DOG' })
  species: string;

  @ApiProperty({
    description: 'Age in years (null if unknown)',
    example: 2,
    nullable: true,
  })
  age: number | null;

  @ApiProperty({ description: 'Age group classification', example: 'ADULT' })
  ageGroup: string;

  @ApiProperty({
    description: 'Region considered',
    example: 'CA',
    nullable: true,
  })
  region: string | null;

  @ApiProperty({
    description: 'Breed considered',
    example: 'Golden Retriever',
    nullable: true,
  })
  breed: string | null;

  @ApiProperty({ description: 'Whether the listing has photos', example: true })
  hasPhoto: boolean;

  @ApiProperty({ description: 'Description word count', example: 45 })
  descriptionWordCount: number;

  @ApiProperty({ description: 'Listing quality score (0-100)', example: 85 })
  listingQualityScore: number;
}

export class AdoptionTimePredictionDto {
  @ApiProperty({
    description:
      'Estimated median days to adoption based on historical read model data',
    example: 14.5,
  })
  estimatedDaysToAdoption: number;

  @ApiProperty({
    description: 'Estimated typical range in days (lower and upper bounds)',
    example: { minDays: 8, maxDays: 22 },
  })
  estimatedRange: { minDays: number; maxDays: number };

  @ApiProperty({
    description:
      'Confidence indicator for the prediction based on supporting sample size',
    enum: ConfidenceLevel,
    example: ConfidenceLevel.HIGH,
  })
  confidence: ConfidenceLevel;

  @ApiProperty({
    description:
      'Explainable note describing how confidence and prediction were derived',
    example:
      'High confidence: based on 32 historical adoptions for DOG (ADULT) in CA.',
  })
  confidenceNote: string;

  @ApiProperty({
    description: 'Features and inputs used to generate this prediction',
    type: PredictionFeaturesDto,
  })
  featuresUsed: PredictionFeaturesDto;

  @ApiProperty({
    description: 'Listing quality analysis and recommended improvements',
    type: ListingQualityDto,
  })
  listingQuality: ListingQualityDto;

  @ApiProperty({
    description:
      'Safeguard disclaimer: No automated decisions are made about users.',
    example:
      'Informational estimate only. No automated decisions are made regarding users or eligibility.',
  })
  disclaimer: string;
}

export class BacktestResultDto {
  @ApiProperty({
    description: 'Number of historical adoptions evaluated in backtest',
    example: 120,
  })
  sampleSize: number;

  @ApiProperty({
    description: 'Mean Absolute Error (MAE) in days',
    example: 4.8,
  })
  meanAbsoluteErrorDays: number;

  @ApiProperty({
    description: 'Median Absolute Error (MdAE) in days',
    example: 3.5,
  })
  medianAbsoluteErrorDays: number;

  @ApiProperty({
    description: 'Root Mean Squared Error (RMSE) in days',
    example: 6.9,
  })
  rootMeanSquaredErrorDays: number;

  @ApiProperty({
    description:
      'Percentage of predictions within +/- 7 days of actual adoption',
    example: 76.5,
  })
  accuracyWithin7DaysPercentage: number;

  @ApiProperty({
    description:
      'Percentage of predictions within +/- 14 days of actual adoption',
    example: 91.2,
  })
  accuracyWithin14DaysPercentage: number;

  @ApiProperty({
    description: 'Timestamp when backtest was performed',
    example: '2026-11-21T21:30:00.000Z',
  })
  testedAt: string;

  @ApiProperty({
    description:
      'Summary documentation of historical error and validation methodology',
  })
  notes: string;
}
