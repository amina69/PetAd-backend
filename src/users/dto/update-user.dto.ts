import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @ApiPropertyOptional({ example: 'John' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @ApiPropertyOptional({ example: 'Doe' })
  lastName?: string;
}
