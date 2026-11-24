import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import type {
  MailMessage,
  MailProvider,
  MailSendResult,
} from './mail-provider.interface';

@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly logger = new Logger(SmtpMailProvider.name);
  private readonly transporter: Transporter | null;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      return;
    }

    this.transporter = null;
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    if (!this.transporter) {
      throw new Error(
        'Email service is not configured. Required SMTP variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS',
      );
    }

    const result = (await this.transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    })) as {
      messageId?: string;
      accepted?: Array<string | { address: string }>;
      rejected?: Array<string | { address: string }>;
    };

    // Never log the recipient address or body here; the caller logs safely.
    this.logger.debug('SMTP provider accepted a message');

    return {
      messageId: result.messageId ?? '',
      accepted: (result.accepted ?? []).map(String),
      rejected: (result.rejected ?? []).map(String),
    };
  }
}
