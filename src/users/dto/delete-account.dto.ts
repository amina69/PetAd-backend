import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Account deletion requires password re-authentication when a user deletes
 * their own account. Admins deleting another account supply no password.
 */
export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({
    example: 'StrongPassword123',
    description:
      'Required when deleting your own account; ignored for admin deletions.',
  })
  password?: string;
}
