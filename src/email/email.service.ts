import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SendTransactionalEmailDto } from './dto/send-transactional-email.dto';
import {
  EmailRateLimitError,
  PermanentEmailError,
  TransientEmailError,
} from './email.errors';
import { MAIL_PROVIDER } from './providers/mail-provider.interface';
import type { MailProvider } from './providers/mail-provider.interface';
import { SmtpMailProvider } from './providers/smtp-mail.provider';
import { EmailTemplateService } from './template.service';

export interface SendEmailResult {
  message: string;
  messageId: string;
  accepted: string[];
  rejected: string[];
  skipped?: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;
  private readonly provider: MailProvider & { isConfigured?: () => boolean };
  private readonly templates: EmailTemplateService;
  private readonly rateLimitPerMinute: number;
  /** Per-recipient send timestamps (sliding 60s window). */
  private readonly sendHistory = new Map<string, number[]>();
  private readonly rateLimitWindowMs = 60_000;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(MAIL_PROVIDER)
    provider?: MailProvider,
    @Optional()
    templateService?: EmailTemplateService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {
    this.from =
      this.configService.get<string>('SMTP_FROM') ??
      'PetAd <no-reply@petad.local>';
    this.provider = provider ?? new SmtpMailProvider(this.configService);
    this.templates = templateService ?? new EmailTemplateService();
    this.rateLimitPerMinute =
      this.configService.get<number>('EMAIL_RATE_LIMIT_PER_MINUTE') ?? 20;
  }

  /**
   * Sends an email. Templated messages render HTML and a plain-text part;
   * raw messages use the supplied text/html.
   *
   * Errors are classified so the queue can decide whether to retry:
   * `PermanentEmailError` is never retried, `TransientEmailError` is.
   */
  async sendTransactionalEmail(
    dto: SendTransactionalEmailDto,
  ): Promise<SendEmailResult> {
    if (await this.isSuppressed(dto.to)) {
      // Acceptance: a suppressed address is skipped *and* logged.
      this.logger.warn(
        `Skipping email to suppressed address ${dto.to} (action=EMAIL_SUPPRESSED_SKIP)`,
      );
      return {
        message: 'Email skipped: recipient is suppressed',
        messageId: '',
        accepted: [],
        rejected: [dto.to],
        skipped: true,
      };
    }

    this.assertWithinRateLimit(dto.to);

    const { subject, text, html } = this.renderMessage(dto);
    const headers = this.buildHeaders(dto);

    try {
      const result = await this.provider.send({
        from: this.from,
        to: dto.to,
        subject,
        text,
        html,
        headers,
      });

      if (!result.messageId || result.accepted.length === 0) {
        const reason = 'Email provider did not accept the message';
        await this.suppressMany(result.rejected, 'HARD_BOUNCE');
        this.logger.error(
          `Failed to send transactional email to ${dto.to}: ${reason}`,
        );
        throw new PermanentEmailError(reason, 'HARD_BOUNCE');
      }

      // Provider-level rejections (e.g. one bad address among several) are
      // hard bounces: suppress them so we never retry or resend.
      await this.suppressMany(result.rejected, 'HARD_BOUNCE');

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
      if (error instanceof PermanentEmailError) {
        throw error;
      }
      if (error instanceof EmailRateLimitError) {
        throw error;
      }

      const reason =
        error instanceof Error
          ? error.message
          : 'Unknown transport error while sending email';

      this.logger.error(
        `Failed to send transactional email to ${dto.to}: ${reason}`,
      );

      if (this.isPermanentTransportError(error)) {
        await this.suppress(dto.to, 'HARD_BOUNCE');
        throw new PermanentEmailError(
          `Failed to send email to ${dto.to}: ${reason}`,
          'HARD_BOUNCE',
        );
      }

      throw new TransientEmailError(
        `Failed to send email to ${dto.to}: ${reason}`,
      );
    }
  }

  /** Convenience wrapper for templated messages. */
  async sendTemplatedEmail(params: {
    to: string;
    subject: string;
    template: string;
    context?: Record<string, unknown>;
    category?: SendTransactionalEmailDto['category'];
  }): Promise<SendEmailResult> {
    return this.sendTransactionalEmail({
      to: params.to,
      subject: params.subject,
      template: params.template,
      context: params.context ?? {},
      category: params.category,
    });
  }

  async isSuppressed(email: string): Promise<boolean> {
    if (!this.prisma) {
      return false;
    }
    const row = await this.prisma.emailSuppression.findUnique({
      where: { email: email.toLowerCase() },
    });
    return !!row;
  }

  async suppress(
    email: string,
    reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL',
  ): Promise<void> {
    if (!this.prisma) {
      return;
    }
    const normalised = email.toLowerCase();
    await this.prisma.emailSuppression.upsert({
      where: { email: normalised },
      create: { email: normalised, reason },
      update: { reason },
    });
    this.logger.warn(`Email address suppressed (reason=${reason})`);
  }

  private async suppressMany(
    addresses: string[],
    reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL',
  ): Promise<void> {
    for (const address of addresses) {
      if (typeof address === 'string' && address.includes('@')) {
        await this.suppress(address, reason);
      }
    }
  }

  private renderMessage(dto: SendTransactionalEmailDto): {
    subject: string;
    text: string;
    html?: string;
  } {
    if (dto.template) {
      const rendered = this.templates.render(dto.template, {
        ...(dto.context ?? {}),
        subject: dto.subject,
      });
      return {
        subject: dto.subject,
        text: rendered.text,
        html: rendered.html,
      };
    }

    const text = dto.text ?? (dto.html ? this.stripHtml(dto.html) : '');
    return { subject: dto.subject, text, html: dto.html };
  }

  private buildHeaders(
    dto: SendTransactionalEmailDto,
  ): Record<string, string> | undefined {
    if (dto.category !== 'marketing') {
      return undefined;
    }

    const unsubscribeAddress =
      this.configService.get<string>('SMTP_UNSUBSCRIBE') ??
      this.from.match(/<([^>]+)>/)?.[1] ??
      'no-reply@petad.local';

    return {
      'List-Unsubscribe': `<mailto:${unsubscribeAddress}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  private assertWithinRateLimit(recipient: string): void {
    const now = Date.now();
    const recent = (this.sendHistory.get(recipient) ?? []).filter(
      (timestamp) => now - timestamp < this.rateLimitWindowMs,
    );

    if (recent.length >= this.rateLimitPerMinute) {
      throw new EmailRateLimitError(
        `Rate limit exceeded for recipient ${recipient}; retry later`,
      );
    }

    recent.push(now);
    this.sendHistory.set(recipient, recent);
  }

  private isPermanentTransportError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const candidate = error as { code?: string; responseCode?: number };
    if (candidate.code === 'EENVELOPE') {
      return true;
    }
    // SMTP 5xx class: permanent failure (550 mailbox unavailable, 551, 553).
    return (
      typeof candidate.responseCode === 'number' &&
      candidate.responseCode >= 500 &&
      candidate.responseCode < 600
    );
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
