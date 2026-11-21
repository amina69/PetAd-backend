import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MoneyDto {
  @ApiProperty({ example: '100.00', description: 'Decimal string, never a float' })
  amount: string;

  @ApiProperty({ example: 'XLM', description: 'ISO asset or currency code' })
  currency: string;
}

export class ApprovalPartyDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Jane' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;
}

export class ApprovalPetDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Buddy' })
  name: string;

  @ApiProperty({ example: 'DOG' })
  species: string;

  @ApiPropertyOptional({ nullable: true, example: 'https://example.com/buddy.jpg' })
  imageUrl: string | null;
}

export class ApprovalResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'APPROVED', enum: ['APPROVED', 'REJECTED'] })
  status: string;

  @ApiPropertyOptional({ nullable: true, example: 'Looks good' })
  notes: string | null;

  @ApiProperty({ example: 'uuid' })
  petId: string;

  @ApiProperty({ example: 'uuid' })
  adopterId: string;

  @ApiProperty({ example: 'uuid' })
  ownerId: string;

  @ApiPropertyOptional({ nullable: true, example: 'uuid' })
  escrowId: string | null;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt: string;

  @ApiProperty({ type: ApprovalPetDto })
  pet: ApprovalPetDto;

  @ApiProperty({ type: ApprovalPartyDto })
  adopter: ApprovalPartyDto;

  @ApiProperty({ type: ApprovalPartyDto })
  owner: ApprovalPartyDto;
}

export class DisputeDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  escrowId: string;

  @ApiPropertyOptional({ nullable: true, example: 'uuid' })
  adoptionId: string | null;

  @ApiProperty({ example: 'OPEN', enum: ['OPEN', 'RESOLVED'] })
  status: string;

  @ApiPropertyOptional({ nullable: true, example: 'Funds not released' })
  reason: string | null;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  openedAt: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-01-02T00:00:00.000Z' })
  resolvedAt: string | null;
}

export class NotificationDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ADOPTION_APPROVED' })
  type: string;

  @ApiProperty({ example: 'Adoption approved' })
  title: string;

  @ApiProperty({ example: 'Your adoption request was approved.' })
  message: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-01-01T00:00:00.000Z' })
  readAt: string | null;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt: string;
}

export class PaymentDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  escrowId: string;

  @ApiProperty({ type: MoneyDto })
  amount: MoneyDto;

  @ApiProperty({ example: 'FUNDED' })
  status: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt: string;
}
