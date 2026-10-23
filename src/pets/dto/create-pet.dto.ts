import {
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  IsEnum,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PetGender, PetSize, PetSpecies } from '../../common/enums';

export class CreatePetDto {
  @ApiProperty({ description: 'Pet name' })
  @IsString()
  name: string;

  @ApiProperty({ enum: PetSpecies, description: 'Species (e.g., DOG, CAT)' })
  @IsEnum(PetSpecies)
  species: PetSpecies;

  @ApiPropertyOptional({ description: 'Breed' })
  @IsString()
  @IsOptional()
  breed?: string;

  @ApiPropertyOptional({ description: 'Age in years' })
  @IsInt()
  @IsOptional()
  age?: number;

  @ApiPropertyOptional({ enum: PetGender, description: 'Gender' })
  @IsEnum(PetGender)
  @IsOptional()
  gender?: PetGender;

  @ApiPropertyOptional({ enum: PetSize, description: 'Size' })
  @IsEnum(PetSize)
  @IsOptional()
  size?: PetSize;

  @ApiPropertyOptional({ description: 'Color' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Image URLs', type: [String] })
  @IsArray()
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({
    description: 'City where the pet is located (coarse, safe to expose)',
    example: 'Berlin',
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  city?: string;

  @ApiPropertyOptional({
    description: 'State / province / region where the pet is located',
    example: 'Berlin',
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  state?: string;

  @ApiPropertyOptional({
    description: 'Country where the pet is located',
    example: 'Germany',
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  country?: string;

  @ApiPropertyOptional({
    description:
      'Listing latitude. Stored rounded to ~100 m (3 decimal places) so an owner’s exact address is never persisted.',
    example: 52.52,
  })
  @IsLatitude()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({
    description:
      'Listing longitude. Stored rounded to ~100 m (3 decimal places) so an owner’s exact address is never persisted.',
    example: 13.405,
  })
  @IsLongitude()
  @IsOptional()
  longitude?: number;
}
