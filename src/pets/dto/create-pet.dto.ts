import { IsString, IsInt, IsOptional, IsArray, IsEnum } from 'class-validator';
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
}
