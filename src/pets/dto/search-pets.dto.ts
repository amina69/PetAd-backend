import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PetSpecies, PetGender, PetSize } from '../../common/enums';
import { ComputedPetStatus } from '../pet-availability.service';

/**
 * Search and Pagination DTO for Pets
 * Handles pagination parameters and optional filters
 */
export class SearchPetsDto {
  // ========== Pagination Parameters ==========

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number (starts from 1)',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Number of items per page (max 100)',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  limit?: number = 20;

  // ========== Filter Parameters ==========

  @ApiPropertyOptional({
    enum: PetSpecies,
    description: 'Filter by species',
    example: PetSpecies.DOG,
  })
  @IsOptional()
  @IsEnum(PetSpecies, { message: 'Invalid species value' })
  species?: PetSpecies;

  @ApiPropertyOptional({
    enum: PetGender,
    description: 'Filter by gender',
    example: PetGender.MALE,
  })
  @IsOptional()
  @IsEnum(PetGender, { message: 'Invalid gender value' })
  gender?: PetGender;

  @ApiPropertyOptional({
    enum: PetSize,
    description: 'Filter by size',
    example: PetSize.MEDIUM,
  })
  @IsOptional()
  @IsEnum(PetSize, { message: 'Invalid size value' })
  size?: PetSize;

  @ApiPropertyOptional({
    enum: ComputedPetStatus,
    description: 'Filter by status (defaults to AVAILABLE for public)',
    example: ComputedPetStatus.AVAILABLE,
  })
  @IsOptional()
  @IsEnum(ComputedPetStatus, { message: 'Invalid status value' })
  status?: ComputedPetStatus;

  @ApiPropertyOptional({
    description: 'Search by name or breed (case-insensitive)',
    example: 'Golden Retriever',
  })
  @IsOptional()
  @IsString({ message: 'Search must be a string' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  search?: string;
}
