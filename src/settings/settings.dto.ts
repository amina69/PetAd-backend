import {
  IsInt,
  IsNumber,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Representation/safety limits, not policy defaults. Percentages use percent
// units ("7.5" means 7.5%), not a fractional rate; money is in USD cents.
export const MAX_MINOR_UNITS = 999_999_999_999;
export const MAX_ACCOUNT_AGE_DAYS = 200_000_000;
const MULTIPLIER = /^(?:(?:[1-9]\d?)(?:\.\d{1,18})?|100(?:\.0{1,18})?)$/;
const PERCENTAGE = /^(?:(?:0|[1-9]\d?)(?:\.\d{1,18})?|100(?:\.0{1,18})?)$/;

export class TrustPolicyValueDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  minimumCustodyTrustScore: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  lowScoreThreshold: number;

  @IsString()
  @Matches(MULTIPLIER, { message: 'lowScoreDepositMultiplier must be a decimal string from 1 to 100 with at most 18 fractional digits' })
  lowScoreDepositMultiplier: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  manualReviewThreshold: number;

  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNT_AGE_DAYS)
  newAccountAgeDays: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  newAccountRequestCap24h: number;
}

export class CustodyFeesValueDto {
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR_UNITS)
  dailyRateMinor: number;

  @IsString()
  @Matches(PERCENTAGE, { message: 'serviceFeePercentage must be a decimal string from 0 to 100 with at most 18 fractional digits' })
  serviceFeePercentage: string;

  @IsInt()
  @Min(0)
  @Max(MAX_MINOR_UNITS)
  baseDepositMinor: number;
}

export class UpdateSettingDto {
  @IsObject()
  value: Record<string, unknown>;

  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(2000)
  reason: string;
}

export class RollbackSettingDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version: number;

  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(2000)
  reason: string;
}
