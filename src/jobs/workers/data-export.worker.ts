import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  getQueueConcurrency,
  getQueuePrefix,
  getRedisConnection,
  JobName,
  QueueName,
  type ProcessDataExportJob,
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

  onModuleInit(): void {
    try {
      const connection = getRedisConnection(this.configService);
      const concurrency = getQueueConcurrency(this.configService);

      this.worker = new Worker(
        QueueName.DATA_EXPORT,
        async (job) => {
          if (String(job.name) === String(JobName.PROCESS_DATA_EXPORT)) {
            await this.processor.process(job as ProcessDataExportJob);
          }
        },
        {
          connection,
          prefix: getQueuePrefix(this.configService),
          concurrency,
        },
      );
      this.logger.log(
        `DataExportWorker initialized for queue: ${QueueName.DATA_EXPORT}`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `DataExportWorker could not start Redis worker: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
