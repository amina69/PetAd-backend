import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  ANCHORING_QUEUE_NAME,
  ANCHOR_EVENTS_JOB_NAME,
  getQueueConcurrency,
  getRedisConnection,
} from '../queues/queue.config';
import { AnchoringProcessor } from '../processors/anchoring.processor';

@Injectable()
export class AnchoringWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly stellarEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: AnchoringProcessor,
  ) {
    const stellarEnabledVal = this.configService.get<string>('STELLAR_ENABLED');
    this.stellarEnabled = stellarEnabledVal !== 'false';
  }

  async onModuleInit() {
    if (!this.stellarEnabled) {
      this.logger.log('STELLAR_ENABLED is false; AnchoringWorker is disabled.');
      return;
    }

    try {
      const connection = getRedisConnection(this.configService);
      const concurrency = getQueueConcurrency(this.configService);

      this.worker = new Worker(
        ANCHORING_QUEUE_NAME,
        async (job: Job<any>) => {
          if (job.name === ANCHOR_EVENTS_JOB_NAME) {
            await this.processor.process(job);
          }
        },
        {
          connection,
          concurrency: 1,
        },
      );
      this.logger.log(
        `AnchoringWorker initialized for queue: ${ANCHORING_QUEUE_NAME}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `AnchoringWorker could not start Redis worker: ${error.message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
