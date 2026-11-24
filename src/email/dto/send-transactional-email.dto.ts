import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export type EmailCategory = 'essential' | 'transactional' | 'marketing';

export class SendTransactionalEmailDto {
  @IsEmail()
  to: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  // Required unless `template` is supplied; templated emails render both
  // HTML and plain-text parts from Handlebars templates.
  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  html?: string;

  @IsString()
  @IsOptional()
  template?: string;

  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;

  /**
   * Non-essential mail (marketing) receives List-Unsubscribe headers.
   * Account/security mail stays essential and is always delivered.
   */
  @IsIn(['essential', 'transactional', 'marketing'])
  @IsOptional()
  category?: EmailCategory;
}
