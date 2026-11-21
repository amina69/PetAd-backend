import { ApiProperty } from '@nestjs/swagger';

export class PetResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'Buddy' })
  name: string;

  @ApiProperty({ example: 'DOG' })
  species: string;

  @ApiProperty({ type: String, example: 'Golden Retriever', nullable: true })
  breed: string | null;

  @ApiProperty({ type: Number, example: 3, nullable: true })
  age: number | null;

  @ApiProperty({
    type: String,
    example: 'Friendly and energetic dog',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    type: String,
    example: 'https://example.com/image.jpg',
    nullable: true,
  })
  imageUrl: string | null;
}

export class CustodyResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'PENDING' })
  status: string;

  @ApiProperty({ example: 'TEMPORARY' })
  type: string;

  @ApiProperty({
    nullable: true,
    oneOf: [{ type: 'number' }, { type: 'string' }],
    example: '100.00',
    description: 'Deposit amount; decimals are serialized as strings by Prisma',
  })
  depositAmount: number | string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2024-12-25T00:00:00.000Z',
  })
  startDate: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2025-01-08T00:00:00.000Z',
    nullable: true,
  })
  endDate: Date | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  petId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  holderId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', nullable: true })
  escrowId: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2024-12-20T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2024-12-20T00:00:00.000Z',
  })
  updatedAt: Date;

  @ApiProperty({ type: PetResponseDto })
  pet: PetResponseDto;
}
