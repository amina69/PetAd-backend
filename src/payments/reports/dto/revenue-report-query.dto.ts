import {
  IsDateString,
  IsEnum,
  IsOptional,
} from 'class-validator';

export enum RevenueGroupBy {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export enum RevenueFormat {
  JSON = 'json',
  CSV = 'csv',
}

export class RevenueReportQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsEnum(RevenueGroupBy)
  groupBy?: RevenueGroupBy;

  @IsOptional()
  @IsEnum(RevenueFormat)
  format?: RevenueFormat;
}
