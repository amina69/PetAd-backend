import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  JobName,
  QueueName,
  type SendTransactionalEmailJobPayload,
} from '../queues/queue.config';
import { TypedQueueService } from '../queues/typed-queue.service';

export type SendTransactionalEmailJobInput = SendTransactionalEmailJobPayload;

@Injectable()
export class NotificationQueueService {
  constructor(private readonly queues: TypedQueueService) {}

  async enqueueSendTransactionalEmail(
    input: SendTransactionalEmailJobInput,
  ): Promise<Job<SendTransactionalEmailJobPayload>> {
    return this.queues.add(
      QueueName.NOTIFICATIONS,
      JobName.SEND_TRANSACTIONAL_EMAIL,
      input,
    );
  }
}
