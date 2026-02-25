import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {

  @IsEmail()
  @ApiProperty({
    example: 'user@email.com',
    description: 'Registered email address',
  })
  email: string;

  @IsNotEmpty()
  @ApiProperty({
    example: 'StrongPassword123',
    description: 'User password',
  })
  password: string;
}

