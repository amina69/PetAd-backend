import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The only profile fields a user may change through PATCH /users/:id.
 *
 * Everything else (notably `email`, `role` and `trustScore`) is deliberately
 * absent so the global ValidationPipe (`forbidNonWhitelisted: true`) rejects
 * the request. Email changes must go through the re-verification flow, and
 * role/trustScore are only ever changed by privileged server-side flows.
 */
export const UPDATABLE_USER_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'bio',
  'location',
] as const;

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @ApiPropertyOptional({ example: 'John' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @ApiPropertyOptional({ example: 'Doe' })
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9][0-9\s()-]{6,19}$/, {
    message: 'phone must be a valid phone number',
  })
  @ApiPropertyOptional({ example: '+2348012345678' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({ example: 'Dog lover, weekend volunteer.' })
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiPropertyOptional({ example: 'Lagos, Nigeria' })
  location?: string;
}
