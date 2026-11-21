import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class TrustScoreFactorDto {
  @ApiProperty()
  @IsString()
  key!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  count!: number;

  @ApiProperty()
  @IsNumber()
  contribution!: number;
}

export class TrustProofEntryDto {
  @ApiProperty()
  @IsString()
  eventId!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  hash!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  anchorBatchId?: string | null;
}

export class TrustProofDto {
  @ApiProperty()
  @IsString()
  version!: string;

  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty()
  @IsString()
  algorithmVersion!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  eventIds!: string[];

  @ApiProperty({ type: [TrustProofEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrustProofEntryDto)
  proofs!: TrustProofEntryDto[];

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  rootHash!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  anchoredThrough?: string | null;
}

export class VerifyProofDto extends TrustProofDto {}

export class TrustBackfillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  algorithmVersion?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsIn([true, false])
  dryRun?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsIn([true, false])
  confirm?: boolean;
}
