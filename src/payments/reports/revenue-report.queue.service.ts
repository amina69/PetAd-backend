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
  GENERATE_REVENUE_REPORT_JOB_NAME,
  getJobAttempts,
  getJobBackoffDelay,
  getRedisConnection,
  REVENUE_REPORT_QUEUE_NAME,
} from '../../jobs/queues/queue.config';
import { RevenueReportProcessor } from './processors/revenue-report.processor';

export interface RevenueReportJobPayload {
  jobId: string;
}

@Injectable()
export class RevenueReportQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(RevenueReportQueueService.name);
  private queue: Queue<RevenueReportJobPayload> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => RevenueReportProcessor))
    private readonly processor?: RevenueReportProcessor,
  ) {
    try {
      this.queue = new Queue(REVENUE_REPORT_QUEUE_NAME, {
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
        'Redis not configured for revenue report queue; using in-memory async fallback.',
      );
    }
  }

  async enqueueRevenueReport(payload: RevenueReportJobPayload): Promise<void> {
    if (this.queue) {
      await this.queue.add(GENERATE_REVENUE_REPORT_JOB_NAME, payload);
      return;
    }

    setImmediate(() => {
      this.processor?.process(payload).catch((error: Error) => {
        this.logger.error(`Revenue report fallback failed: ${error.message}`);
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
