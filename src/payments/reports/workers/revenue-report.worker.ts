import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import {
  GENERATE_REVENUE_REPORT_JOB_NAME,
  getRedisConnection,
  REVENUE_REPORT_QUEUE_NAME,
} from '../../../jobs/queues/queue.config';
import { RevenueReportJobPayload } from '../revenue-report.queue.service';
import { RevenueReportProcessor } from '../processors/revenue-report.processor';

@Injectable()
export class RevenueReportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevenueReportWorker.name);
  private worker: Worker<RevenueReportJobPayload> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: RevenueReportProcessor,
  ) {}

  onModuleInit(): void {
    try {
      this.worker = new Worker<RevenueReportJobPayload>(
        REVENUE_REPORT_QUEUE_NAME,
        async (job) => {
          if (job.name === GENERATE_REVENUE_REPORT_JOB_NAME) {
            await this.processor.process(job.data);
          }
        },
        { connection: getRedisConnection(this.configService) },
      );
    } catch {
      this.logger.warn(
        'Redis not configured; revenue report worker disabled (in-memory fallback in use).',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
