import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SendTransactionalEmailDto {
  @IsEmail()
  @MaxLength(254)
  to: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  text: string;

  @IsString()
  @IsOptional()
  @MaxLength(100_000)
  html?: string;
}
