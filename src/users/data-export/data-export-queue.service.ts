import {
  Injectable,
  Logger,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobName, QueueName } from '../../jobs/queues/queue.config';
import { TypedQueueService } from '../../jobs/queues/typed-queue.service';
import { DataExportService } from './data-export.service';

export type { DataExportJobPayload } from '../../jobs/queues/queue.config';

import type { DataExportJobPayload } from '../../jobs/queues/queue.config';

@Injectable()
export class DataExportQueueService {
  private readonly logger = new Logger(DataExportQueueService.name);
  private readonly redisEnabled: boolean;

  constructor(
    private readonly queues: TypedQueueService,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => DataExportService))
    private readonly dataExportService?: DataExportService,
  ) {
    this.redisEnabled = Boolean(this.configService.get<string>('REDIS_URL'));
    if (!this.redisEnabled) {
      this.logger.warn(
        'Redis not configured for BullMQ; DataExportQueueService will use in-memory execution.',
      );
    }
  }

  async enqueueDataExport(payload: DataExportJobPayload): Promise<void> {
    if (this.redisEnabled) {
      await this.queues.add(
        QueueName.DATA_EXPORT,
        JobName.PROCESS_DATA_EXPORT,
        payload,
      );
      this.logger.log(`Enqueued data export job ${payload.exportId} to BullMQ`);
      return;
    }

    if (this.dataExportService) {
      setImmediate(() => {
        this.dataExportService
          ?.processDataExport(payload.exportId, payload.userId)
          .catch((error: Error) => {
            this.logger.error(
              `Fallback data export processing error: ${error.message}`,
            );
          });
      });
    }
  }
}
