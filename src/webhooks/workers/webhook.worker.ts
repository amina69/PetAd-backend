import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import {
  getRedisConnection,
  PROCESS_WEBHOOK_JOB_NAME,
  WEBHOOK_QUEUE_NAME,
} from '../../jobs/queues/queue.config';
import { WebhookJobPayload } from '../webhook.queue.service';
import { WebhookProcessor } from '../processors/webhook.processor';

@Injectable()
export class WebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorker.name);
  private worker: Worker<WebhookJobPayload> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: WebhookProcessor,
  ) {}

  onModuleInit(): void {
    try {
      this.worker = new Worker<WebhookJobPayload>(
        WEBHOOK_QUEUE_NAME,
        async (job) => {
          if (job.name === PROCESS_WEBHOOK_JOB_NAME) {
            await this.processor.process(job.data);
          }
        },
        { connection: getRedisConnection(this.configService) },
      );
    } catch {
      this.logger.warn(
        'Redis not configured; webhook worker disabled (in-memory fallback in use).',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
