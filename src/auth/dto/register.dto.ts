import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {

  @IsEmail()
  @ApiProperty({
     example: 'user@email.com',
    description: 'Registered email address',
})
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  @ApiProperty({
    example: 'StrongPassword123',
    description: 'User password has minimum length of 8 characters',
  })
  password: string;

  @IsNotEmpty()
  @ApiProperty({ example: 'Bola' })
  firstName: string;

  @IsNotEmpty()
  @ApiProperty({ example: 'Bimbo' })
  lastName: string;
}
