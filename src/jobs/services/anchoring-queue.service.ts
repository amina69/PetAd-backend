import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  ANCHORING_QUEUE_NAME,
  ANCHOR_EVENTS_JOB_NAME,
  getJobAttempts,
  getJobBackoffDelay,
  getRedisConnection,
} from '../queues/queue.config';

export interface AnchoringJobPayload {
  batchId: string;
  network?: string;
}

@Injectable()
export class AnchoringQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AnchoringQueueService.name);
  private queue: Queue<AnchoringJobPayload> | null = null;
  private readonly stellarEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const stellarEnabledVal = this.configService.get<string>('STELLAR_ENABLED');
    this.stellarEnabled = stellarEnabledVal !== 'false';

    if (!this.stellarEnabled) {
      this.logger.log('STELLAR_ENABLED is false; anchoring queue is disabled.');
      return;
    }

    try {
      const connection = getRedisConnection(this.configService);
      const attempts = getJobAttempts(this.configService);
      const backoffDelay = getJobBackoffDelay(this.configService);

      this.queue = new Queue(ANCHORING_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts,
          backoff: { type: 'fixed', delay: backoffDelay },
        },
      });
    } catch {
      this.logger.warn(
        'Redis not configured or unavailable for BullMQ; AnchoringQueueService will be disabled.',
      );
    }
  }

  async enqueueAnchoringJob(event: any): Promise<void> {
    if (!this.stellarEnabled) {
      return;
    }

    if (this.queue) {
      const batchId = `batch-${Math.floor(Date.now() / 60000)}-${event.entityType || 'GLOBAL'}`;
      await this.queue.add(
        ANCHOR_EVENTS_JOB_NAME,
        { batchId, network: event.entityType || 'default' },
        { jobId: batchId },
      );
      this.logger.log(`Enqueued anchoring job batch ${batchId} to BullMQ`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
