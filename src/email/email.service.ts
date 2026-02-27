import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { SendTransactionalEmailDto } from './dto/send-transactional-email.dto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

    this.from =
      this.configService.get<string>('SMTP_FROM') ??
      'PetAd <no-reply@petad.local>';

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass,
        },
      });
      return;
    }

    this.transporter = null;
  }

  async sendTransactionalEmail(dto: SendTransactionalEmailDto): Promise<{
    message: string;
    messageId: string;
    accepted: string[];
    rejected: string[];
  }> {
    try {
      if (!this.transporter) {
        throw new InternalServerErrorException(
          'Email service is not configured. Required SMTP variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS',
        );
      }

      const result = await this.transporter.sendMail({
        from: this.from,
        to: dto.to,
        subject: dto.subject,
        text: dto.text,
        html: dto.html,
      });

      if (!result.messageId || result.accepted.length === 0) {
        throw new InternalServerErrorException(
          'Email provider did not accept the message',
        );
      }

      this.logger.log(
        `Transactional email sent to ${dto.to} (messageId: ${result.messageId})`,
      );

      return {
        message: 'Email sent successfully',
        messageId: result.messageId,
        accepted: result.accepted.map(String),
        rejected: result.rejected.map(String),
      };
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'Unknown transport error while sending email';

      this.logger.error(
        `Failed to send transactional email to ${dto.to}: ${reason}`,
      );

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Failed to send email to ${dto.to}: ${reason}`,
      );
    }
  }
}
