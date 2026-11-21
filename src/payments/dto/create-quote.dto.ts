import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentPurpose } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CreateQuoteDto {
  @ApiProperty({
    enum: PaymentPurpose,
    description: 'What the payment is for.',
  })
  @IsEnum(PaymentPurpose)
  purpose!: PaymentPurpose;

  @ApiProperty({
    example: '10000000',
    description:
      'Amount in integer minor units, as a decimal string (e.g. stroops for XLM).',
  })
  @IsString()
  @Matches(/^\d{1,19}$/, {
    message: 'amountMinor must be an integer string of minor units',
  })
  amountMinor!: string;

  @ApiPropertyOptional({ example: 'XLM', default: 'XLM' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  @Matches(/^[A-Za-z0-9]+$/)
  currency?: string;

  @ApiPropertyOptional({ description: 'Escrow this payment funds.' })
  @IsOptional()
  @IsUUID()
  escrowId?: string;

  @ApiPropertyOptional({
    description: 'Custody agreement this payment relates to.',
  })
  @IsOptional()
  @IsUUID()
  custodyId?: string;

  @ApiPropertyOptional({ description: 'Adoption this payment relates to.' })
  @IsOptional()
  @IsUUID()
  adoptionId?: string;
}
