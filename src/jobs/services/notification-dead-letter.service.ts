import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import {
  NOTIFICATION_DEAD_LETTER_QUEUE_NAME,
  getRedisConnection,
} from '../queues/queue.config';
import { NotificationMetricsService } from './notification-metrics.service';

export interface DeadLetterPayload {
  originalJobId: string | undefined;
  jobName: string;
  queue: string;
  attemptsMade: number;
  failedReason: string;
  data: unknown;
}

@Injectable()
export class NotificationDeadLetterService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeadLetterService.name);
  private readonly queue: Queue<DeadLetterPayload>;

  constructor(
    configService: ConfigService,
    private readonly metrics: NotificationMetricsService,
  ) {
    this.queue = new Queue(NOTIFICATION_DEAD_LETTER_QUEUE_NAME, {
      connection: getRedisConnection(configService),
    });
  }

  /**
   * Copies a permanently failed job into the DLQ together with the failure
   * reason. The job id makes the copy idempotent.
   */
  async moveToDeadLetter(job: Job, failedReason: string): Promise<void> {
    const payload: DeadLetterPayload = {
      originalJobId: job.id,
      jobName: job.name,
      queue: job.queueName,
      attemptsMade: job.attemptsMade,
      failedReason,
      data: job.data,
    };

    await this.queue.add('dead_letter', payload, {
      jobId: `dlq:${job.id ?? job.name}`,
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.metrics.recordDeadLettered();
    this.logger.error(
      `Notification job ${job.id ?? '<no-id>'} moved to dead-letter queue: ${failedReason}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
