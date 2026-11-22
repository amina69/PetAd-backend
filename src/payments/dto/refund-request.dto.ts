import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRefundRequestDto {
  @ApiProperty({
    minLength: 20,
    description: 'Why the payment should be refunded (at least 20 characters).',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Amount in minor units. Defaults to the full remaining refundable amount.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;
}

export class ApproveRefundDto {
  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Amount in minor units to refund. Omit to approve the requested amount; ' +
      'a smaller amount is recorded as a partial approval.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiProperty({ description: 'Decision reason shown to the requester.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}

export class DenyRefundDto {
  @ApiProperty({
    description: 'Why the request was denied, shown to the requester.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}
