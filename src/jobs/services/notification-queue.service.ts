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

export type SendTransactionalEmailJobInput = {
  dto: SendTransactionalEmailDto;
  metadata?: Record<string, any>;
};

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly queue: Queue<SendTransactionalEmailJobInput>;

  constructor(private readonly configService: ConfigService) {
    const connection = getRedisConnection(configService);
    const attempts = getJobAttempts(configService);
    const backoffDelay = getJobBackoffDelay(configService);

    // Default job options ensure retry/backoff behavior even if callers
    // enqueue jobs without explicit overrides.
    this.queue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts,
        backoff: { type: 'fixed', delay: backoffDelay },
      },
    });
  }

  async enqueueSendTransactionalEmail(
    input: SendTransactionalEmailJobInput,
  ): Promise<Job<SendTransactionalEmailJobInput>> {
    return this.queue.add(
      SEND_TRANSACTIONAL_EMAIL_JOB_NAME,
      input,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

