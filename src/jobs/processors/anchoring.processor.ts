import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { AnchoringJobPayload } from '../services/anchoring-queue.service';

@Injectable()
export class AnchoringProcessor {
  private readonly logger = new Logger(AnchoringProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  async process(job: Job<AnchoringJobPayload>): Promise<number> {
    try {
      this.logger.log(`Processing anchoring job batch ${job.data.batchId}`);
      const unanchored = await (this.prisma as any).eventLog.findMany({
        where: { anchoredAt: null },
        take: 100,
        orderBy: { sequenceNumber: 'asc' },
      });

      if (unanchored.length === 0) {
        return 0;
      }

      const ids = unanchored.map((e: any) => e.id);
      await (this.prisma as any).eventLog.updateMany({
        where: { id: { in: ids } },
        data: { anchoredAt: new Date() },
      });

      this.logger.log(`Successfully anchored ${unanchored.length} events in batch ${job.data.batchId}`);
      return unanchored.length;
    } catch (error: any) {
      await this.loggingService.log({
        level: 'ERROR',
        action: 'ANCHORING_JOB_FAILED',
        message: error.message,
        metadata: { batchId: job.data.batchId },
      });
      throw new Error(`Anchoring job failed: ${error.message}`);
    }
  }
}
