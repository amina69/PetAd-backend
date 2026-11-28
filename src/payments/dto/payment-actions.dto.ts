import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { PaymentStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  quoteId!: string;
}

export class PayPaymentDto {
  @ApiPropertyOptional({
    description:
      'Provider token. Use "decline" with the fake provider to simulate a failure.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  providerToken?: string;
}

export class CompletePaymentDto {
  @ApiPropertyOptional({
    example: '0',
    description:
      'Penalty in minor units withheld from a deposit before the refund is computed.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,19}$/)
  penaltyMinor?: string;
}

export class RefundPaymentDto {
  @ApiProperty({
    example: '2500',
    description: 'Refund amount in integer minor units, as a decimal string.',
  })
  @IsString()
  @Matches(/^\d{1,19}$/, {
    message: 'amountMinor must be an integer string of minor units',
  })
  amountMinor!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Provider token. Use "decline" with the fake provider to simulate a failure.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  providerToken?: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Transform(({ value }) => (typeof value === 'string' ? value : undefined))
  cursor?: string;
}
