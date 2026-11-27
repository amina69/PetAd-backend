import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import {
  getDefaultJobOptions,
  getQueuePrefix,
  getRedisConnection,
  type JobNameFor,
  type JobPayload,
  type QueueName,
  type QueuePayload,
} from './queue.config';

@Injectable()
export class TypedQueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly configService: ConfigService) {}

  getQueue<Q extends QueueName>(
    queueName: Q,
  ): Queue<QueuePayload<Q>, void, string> {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, {
        connection: getRedisConnection(this.configService),
        prefix: getQueuePrefix(this.configService),
        defaultJobOptions: getDefaultJobOptions(this.configService),
      });
      this.queues.set(queueName, queue);
    }

    return queue as Queue<QueuePayload<Q>, void, string>;
  }

  async add<Q extends QueueName, J extends JobNameFor<Q>>(
    queueName: Q,
    jobName: J,
    payload: JobPayload<Q, J>,
  ): Promise<Job<JobPayload<Q, J>, void, J & string>> {
    const queue = this.getQueue(queueName) as unknown as Queue<
      any,
      any,
      string
    >;
    const job = await queue.add(jobName, payload);

    return job as Job<JobPayload<Q, J>, void, J & string>;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
