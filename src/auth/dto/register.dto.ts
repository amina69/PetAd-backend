import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  @ApiProperty({
    example: 'user@email.com',
    description: 'Registered email address',
  })
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @ApiProperty({
    example: 'StrongPassword123',
    description: 'User password has minimum length of 8 characters',
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(50)
  @ApiProperty({ example: 'Bola' })
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(50)
  @ApiProperty({ example: 'Bimbo' })
  lastName: string;
}
