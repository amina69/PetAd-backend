import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ApplyShelterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @ApiProperty({
    example: 'Hope Paws Shelter',
    description: 'Registered organization name',
  })
  orgName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({
    example: 'REG-12345',
    description: 'Official registration number of the organization',
  })
  registrationNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @ApiProperty({
    example: '12 Charity Lane, Lagos',
    description: 'Physical address of the organization',
  })
  address: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiProperty({ example: '+2348012345678', description: 'Contact phone' })
  phone: string;
}
