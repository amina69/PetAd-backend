import { Injectable, Logger, Optional } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { EmailService } from '../../email/email.service';
import { PermanentEmailError } from '../../email/email.errors';
import { LoggingService } from '../../logging/logging.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { SendTransactionalEmailDto } from '../../email/dto/send-transactional-email.dto';

export type SendTransactionalEmailJobPayload = {
  dto: SendTransactionalEmailDto;
  metadata?: Record<string, any>;
};

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly loggingService: LoggingService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async process(job: Job<SendTransactionalEmailJobPayload>): Promise<void> {
    const payload = job.data;
    const to = payload?.dto?.to;
    const subject = payload?.dto?.subject;

    try {
      const result = await this.emailService.sendTransactionalEmail(
        payload.dto,
      );
      await this.markNotification(job, {
        status: result.skipped ? 'SKIPPED' : 'SENT',
        sentAt: result.skipped ? null : new Date(),
        error: null,
      });
      return;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error ?? 'Unknown');

      const descriptiveError = [
        'Notification job failed',
        `(queueJobId=${String(job.id)})`,
        `(jobName=${String(job.name)})`,
        `(to=${String(to)})`,
        `(subject=${String(subject)})`,
        payload?.metadata
          ? `(metadata=${JSON.stringify(payload.metadata)})`
          : '',
        `reason=${reason}`,
      ]
        .filter(Boolean)
        .join(' ');

      // Never log the rendered body — only routing metadata and the reason.
      try {
        await this.loggingService.log({
          level: 'ERROR',
          action: 'NOTIFICATION_JOB_FAILED',
          message: descriptiveError,
          metadata: {
            queue: job.queueName,
            jobId: job.id,
            jobName: job.name,
            to,
            subject,
            ...payload.metadata,
          },
        });
      } catch {
        // Intentionally ignore logging failures.
      }

      this.logger.error(descriptiveError);
      await this.markNotification(job, {
        status: 'FAILED',
        error: reason,
      });

      // Permanent failures (invalid address, hard bounce, suppression) must
      // not burn through the retry budget. BullMQ will not retry this.
      if (error instanceof PermanentEmailError) {
        throw new UnrecoverableError(descriptiveError);
      }

      throw new Error(descriptiveError);
    }
  }

  private async markNotification(
    job: Job<SendTransactionalEmailJobPayload>,
    data: {
      status: 'SENT' | 'SKIPPED' | 'FAILED';
      sentAt?: Date | null;
      error?: string | null;
    },
  ): Promise<void> {
    const notificationId: unknown = job.data?.metadata?.notificationId;
    if (!this.prisma || typeof notificationId !== 'string') {
      return;
    }

    try {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: data.status,
          ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.status === 'FAILED' ? { attempts: { increment: 1 } } : {}),
        },
      });
    } catch {
      // The notification row may have been deleted; the job outcome still
      // stands and is visible through logs/metrics.
    }
  }
}
