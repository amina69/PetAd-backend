import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  getQueueConcurrency,
  getQueuePrefix,
  getRedisConnection,
  JobName,
  QueueName,
  type NotificationEmailJob,
} from '../queues/queue.config';
import { NotificationProcessor } from '../processors/notification.processor';

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationProcessor: NotificationProcessor,
  ) {}

  onModuleInit(): void {
    const connection = getRedisConnection(this.configService);
    const concurrency = getQueueConcurrency(this.configService);

    this.worker = new Worker(
      QueueName.NOTIFICATIONS,
      async (job) => {
        if (String(job.name) !== String(JobName.SEND_TRANSACTIONAL_EMAIL)) {
          throw new Error(
            `Unexpected job name "${job.name}" for queue "${QueueName.NOTIFICATIONS}"`,
          );
        }
        await this.notificationProcessor.process(job as NotificationEmailJob);
      },
      {
        connection,
        prefix: getQueuePrefix(this.configService),
        concurrency,
      },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
