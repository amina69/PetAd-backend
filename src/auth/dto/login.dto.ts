import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  @ApiProperty({
    example: 'user@email.com',
    description: 'Registered email address',
  })
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @ApiProperty({
    example: 'StrongPassword123',
    description: 'User password',
  })
  password: string;
}
