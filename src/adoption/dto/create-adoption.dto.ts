import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class CreateAdoptionDto {
  @IsUUID()
  petId: string;

  @IsUUID()
  ownerId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
