import { ApiProperty } from '@nestjs/swagger';

export class PetResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'Buddy' })
  name: string;

  @ApiProperty({ example: 'DOG' })
  species: string;

  @ApiProperty({ example: 'Golden Retriever', nullable: true })
  breed: string | null;

  @ApiProperty({ example: 3, nullable: true })
  age: number | null;

  @ApiProperty({
    example: 'Friendly and energetic dog',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
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

  @ApiProperty({ example: 100.0, nullable: true })
  depositAmount: number | null;

  @ApiProperty({ example: '2024-12-25T00:00:00.000Z' })
  startDate: Date;

  @ApiProperty({ example: '2025-01-08T00:00:00.000Z' })
  endDate: Date;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  petId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  holderId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', nullable: true })
  escrowId: string | null;

  @ApiProperty({ example: '2024-12-20T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-12-20T00:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ type: PetResponseDto })
  pet: PetResponseDto;
}
