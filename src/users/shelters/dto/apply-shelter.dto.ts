import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyShelterDto {
  @ApiProperty({ example: 'Lagos Happy Paws Shelter' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  orgName: string;

  @ApiProperty({ example: 'RC-1234567' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  registrationNumber: string;

  @ApiProperty({ example: '12 Marina Road, Lagos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address: string;

  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @MinLength(7)
  @MaxLength(30)
  phone: string;
}
