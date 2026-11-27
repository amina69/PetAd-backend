import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import { LoggingService } from '../../logging/logging.service';
import type { NotificationEmailJob } from '../queues/queue.config';

export type { SendTransactionalEmailJobPayload } from '../queues/queue.config';

export type NotificationJobIdempotency = {
  idempotencyKey: string;
  userId?: string;
};

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly processedKeysCache = new Map<string, Date>();

  constructor(
    private readonly emailService: EmailService,
    private readonly loggingService: LoggingService,
  ) {}

  async process(job: NotificationEmailJob): Promise<void> {
    const payload = job.data;
    const to = payload?.dto?.to;
    const subject = payload?.dto?.subject;

    try {
      await this.emailService.sendTransactionalEmail(payload.dto);
      // Record that this key has been processed
      const key = payload.metadata?.idempotencyKey;
      if (key) {
        this.recordProcessedKey(key);
      }
      return;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error ?? 'Unknown');

      // Increment attempt counter and check dead-letter threshold
      const nextAttempts = job.attemptsMade ? job.attemptsMade + 1 : 1;

      if (nextAttempts >= DEAD_LETTER_ATTEMPTS_LIMIT) {
        // Max retry attempts exceeded - signal job failure for dead-letter handling
        const descriptiveError = [
          'Notification job reached max retry attempts',
          `(queueJobId=${String(job.id)})`,
          `(attempts=${String(nextAttempts)})`,
          `(reason=${reason})`,
        ]
          .filter(Boolean)
          .join(' ');

        this.logger.warn(descriptiveError);
        // Re-throw so BullMQ can move the job to the dead-letter queue
        // based on the worker's deadLetterTopic configuration, or the
        // operator can manually intervene via Redis.
        throw new Error(descriptiveError);
      }

      const descriptiveError = [
        'Notification job failed',
        `(queueJobId=${String(job.id)})`,
        `(attempts=${String(nextAttempts)})`,
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

      // Best-effort logging; the job failure should still surface via throwing.
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
            attempts: nextAttempts,
          },
        });
      } catch {
        // Intentionally ignore logging failures.
      }

      this.logger.error(descriptiveError);
      throw new Error(descriptiveError);
    }
  }
}
