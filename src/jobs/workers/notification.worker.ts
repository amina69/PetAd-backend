import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { getRedisConnection } from '../queues/queue.config';
import {
  NOTIFICATION_QUEUE_NAME,
  SEND_TRANSACTIONAL_EMAIL_JOB_NAME,
  getQueueConcurrency,
} from '../queues/queue.config';
import { NotificationProcessor } from '../processors/notification.processor';

@Injectable()
export class NotificationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationProcessor: NotificationProcessor,
  ) {}

  async onModuleInit() {
    const connection = getRedisConnection(this.configService);
    const concurrency = getQueueConcurrency(this.configService);

    // The processor is responsible for throwing descriptive errors.
    this.worker = new Worker(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<any>) => {
        if (job.name !== SEND_TRANSACTIONAL_EMAIL_JOB_NAME) {
          // Misconfigured payload should surface loudly.
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
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}

