import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import { LoggingService } from '../../logging/logging.service';
import type { NotificationEmailJob } from '../queues/queue.config';

export type { SendTransactionalEmailJobPayload } from '../queues/queue.config';

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

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
