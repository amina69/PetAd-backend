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
  DATA_EXPORT_QUEUE_NAME,
  PROCESS_DATA_EXPORT_JOB_NAME,
  getQueueConcurrency,
  getRedisConnection,
} from '../queues/queue.config';
import { DataExportProcessor } from '../processors/data-export.processor';

@Injectable()
export class DataExportWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private readonly logger = new Logger(DataExportWorker.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: DataExportProcessor,
  ) {}

  async onModuleInit() {
    try {
      const connection = getRedisConnection(this.configService);
      const concurrency = getQueueConcurrency(this.configService);

      this.worker = new Worker(
        DATA_EXPORT_QUEUE_NAME,
        async (job: Job<any>) => {
          if (job.name === PROCESS_DATA_EXPORT_JOB_NAME) {
            await this.processor.process(job);
          }
        },
        {
          connection,
          concurrency,
        },
      );
      this.logger.log(
        `DataExportWorker initialized for queue: ${DATA_EXPORT_QUEUE_NAME}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `DataExportWorker could not start Redis worker: ${error.message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
