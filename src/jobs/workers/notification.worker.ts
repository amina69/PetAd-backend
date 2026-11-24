import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATION_QUEUE_NAME,
  SEND_TRANSACTIONAL_EMAIL_JOB_NAME,
  getQueueConcurrency,
  getRedisConnection,
} from '../queues/queue.config';
import { NotificationProcessor } from '../processors/notification.processor';
import { NotificationMetricsService } from '../services/notification-metrics.service';
import { NotificationDeadLetterService } from '../services/notification-dead-letter.service';

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationProcessor: NotificationProcessor,
    private readonly metrics: NotificationMetricsService,
    private readonly deadLetterService: NotificationDeadLetterService,
  ) {}

  onModuleInit(): void {
    const connection = getRedisConnection(this.configService);
    const concurrency = getQueueConcurrency(this.configService);

    // The processor is responsible for throwing descriptive errors.
    this.worker = new Worker(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<any>) => {
        if (job.name !== SEND_TRANSACTIONAL_EMAIL_JOB_NAME) {
          // Misconfigured payload should surface loudly and not retry.
          throw new Error(
            `Unexpected job name "${job.name}" for queue "${NOTIFICATION_QUEUE_NAME}"`,
          );
        }
        await this.notificationProcessor.process(job);
      },
      {
        connection,
        concurrency,
      },
    );

    this.worker.on('completed', (job) => {
      this.metrics.recordSent(this.latencyOf(job));
    });

    this.worker.on('failed', (job, error) => {
      if (!job) {
        return;
      }

      this.metrics.recordFailed(this.latencyOf(job));

      const attempts = job.opts?.attempts ?? 1;
      const exhausted = job.attemptsMade >= attempts;
      const permanent = error?.name === 'UnrecoverableError';

      if (exhausted || permanent) {
        void this.deadLetterService
          .moveToDeadLetter(job, error?.message ?? 'Unknown failure')
          .catch((dlqError: unknown) => {
            const reason =
              dlqError instanceof Error ? dlqError.message : String(dlqError);
            this.logger.error(
              `Failed to move notification job ${job.id} to the DLQ: ${reason}`,
            );
          });
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private latencyOf(job: Job): number {
    const startedAt = job.processedOn ?? job.timestamp;
    return startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  }
}
