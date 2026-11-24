import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import {
  NOTIFICATION_QUEUE_NAME,
  SEND_TRANSACTIONAL_EMAIL_JOB_NAME,
  getJobAttempts,
  getJobBackoffDelay,
  getRedisConnection,
} from '../queues/queue.config';
import type { SendTransactionalEmailDto } from '../../email/dto/send-transactional-email.dto';
import { NotificationMetricsService } from './notification-metrics.service';

export type SendTransactionalEmailJobInput = {
  dto: SendTransactionalEmailDto;
  metadata?: Record<string, any>;
};

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly queue: Queue<SendTransactionalEmailJobInput>;

  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: NotificationMetricsService,
  ) {
    const connection = getRedisConnection(configService);
    const attempts = getJobAttempts(configService);
    const backoffDelay = getJobBackoffDelay(configService);

    // Default job options ensure retry/backoff behavior even if callers
    // enqueue jobs without explicit overrides.
    this.queue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts,
        backoff: { type: 'exponential', delay: backoffDelay },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
  }

  async enqueueSendTransactionalEmail(
    input: SendTransactionalEmailJobInput,
    options: { jobId?: string } = {},
  ): Promise<Job<SendTransactionalEmailJobInput>> {
    const job = await this.queue.add(
      SEND_TRANSACTIONAL_EMAIL_JOB_NAME,
      input,
      options.jobId ? { jobId: options.jobId } : undefined,
    );
    this.metrics.recordQueued();
    return job;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
