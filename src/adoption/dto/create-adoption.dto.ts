import { IsUUID, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAdoptionDto {
  @IsUUID()
  @ApiProperty({ example: 'uuid-of-pet' })
  petId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'I would love to adopt this pet', required: false })
  notes?: string;
}
