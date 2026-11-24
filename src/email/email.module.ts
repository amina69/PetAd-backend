import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from './email.service';
import { EmailTemplateService } from './template.service';
import { MAIL_PROVIDER } from './providers/mail-provider.interface';
import { SmtpMailProvider } from './providers/smtp-mail.provider';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    SmtpMailProvider,
    EmailTemplateService,
    {
      provide: MAIL_PROVIDER,
      useExisting: SmtpMailProvider,
    },
    EmailService,
  ],
  exports: [EmailService, EmailTemplateService],
})
export class EmailModule {}
