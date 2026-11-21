import {
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export interface FeeRule {
  amount?: number;
  hours?: number;
  rateBps?: number;
  currency?: string;
}

export type FeeRuleValue = number | FeeRule;
export type FeeRuleMap = Record<string, Record<string, FeeRuleValue> | FeeRuleValue>;

export class CreateFeeScheduleDto {
  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  platformFeeBps: number;

  @IsNumber()
  @Min(0)
  minimumFee: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  latePenaltyBps: number;

  @IsObject()
  depositRules: FeeRuleMap;

  @IsObject()
  dailyCustodyRates: FeeRuleMap;

  @IsObject()
  cancellationLeadTimes: FeeRuleMap;

  @IsOptional()
  @IsString()
  notes?: string;
}
