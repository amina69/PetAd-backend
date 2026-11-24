import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token sent to the registered email address' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
