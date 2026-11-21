import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  getJobAttempts,
  getJobBackoffDelay,
  getRedisConnection,
  PROCESS_WEBHOOK_JOB_NAME,
  WEBHOOK_QUEUE_NAME,
} from '../jobs/queues/queue.config';
import { WebhookProcessor } from './processors/webhook.processor';

export interface WebhookJobPayload {
  deliveryId: string;
  provider: string;
  eventId: string;
  eventType: string | null;
}

@Injectable()
export class WebhookQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookQueueService.name);
  private queue: Queue<WebhookJobPayload> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => WebhookProcessor))
    private readonly processor?: WebhookProcessor,
  ) {
    try {
      this.queue = new Queue(WEBHOOK_QUEUE_NAME, {
        connection: getRedisConnection(this.configService),
        defaultJobOptions: {
          attempts: getJobAttempts(this.configService),
          backoff: {
            type: 'fixed',
            delay: getJobBackoffDelay(this.configService),
          },
        },
      });
    } catch {
      this.logger.warn(
        'Redis not configured for webhook queue; using in-memory async fallback.',
      );
    }
  }

  async enqueueWebhook(payload: WebhookJobPayload): Promise<void> {
    if (this.queue) {
      await this.queue.add(PROCESS_WEBHOOK_JOB_NAME, payload);
      return;
    }

    setImmediate(() => {
      this.processor?.process(payload).catch((error: Error) => {
        this.logger.error(`Webhook fallback processing failed: ${error.message}`);
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
