import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  DATA_EXPORT_QUEUE_NAME,
  PROCESS_DATA_EXPORT_JOB_NAME,
  getJobAttempts,
  getJobBackoffDelay,
  getRedisConnection,
} from '../../jobs/queues/queue.config';
import { DataExportService } from './data-export.service';

export interface DataExportJobPayload {
  exportId: string;
  userId: string;
}

@Injectable()
export class DataExportQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DataExportQueueService.name);
  private queue: Queue<DataExportJobPayload> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => DataExportService))
    private readonly dataExportService?: DataExportService,
  ) {
    try {
      const connection = getRedisConnection(this.configService);
      const attempts = getJobAttempts(this.configService);
      const backoffDelay = getJobBackoffDelay(this.configService);

      this.queue = new Queue(DATA_EXPORT_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts,
          backoff: { type: 'fixed', delay: backoffDelay },
        },
      });
    } catch {
      this.logger.warn(
        'Redis not configured or unavailable for BullMQ; DataExportQueueService will process jobs via in-memory execution.',
      );
    }
  }

  async enqueueDataExport(payload: DataExportJobPayload): Promise<void> {
    if (this.queue) {
      await this.queue.add(PROCESS_DATA_EXPORT_JOB_NAME, payload);
      this.logger.log(`Enqueued data export job ${payload.exportId} to BullMQ`);
    } else if (this.dataExportService) {
      // In-memory async fallback
      setImmediate(() => {
        this.dataExportService
          ?.processDataExport(payload.exportId, payload.userId)
          .catch((err) => {
            this.logger.error(
              `Fallback data export processing error: ${err.message}`,
            );
          });
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
