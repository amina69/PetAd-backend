import { Injectable, Logger } from '@nestjs/common';
import { DataExportService } from '../../users/data-export/data-export.service';
import { LoggingService } from '../../logging/logging.service';
import type { ProcessDataExportJob } from '../queues/queue.config';

export type { DataExportJobPayload } from '../queues/queue.config';

@Injectable()
export class DataExportProcessor {
  private readonly logger = new Logger(DataExportProcessor.name);
  private readonly processedKeysCache = new Map<string, Date>();

  constructor(
    private readonly dataExportService: DataExportService,
    private readonly loggingService: LoggingService,
  ) {}

  async process(job: ProcessDataExportJob): Promise<void> {
    const { exportId, userId } = job.data;
    const currentAttempts = job.attemptsMade || 0;

    this.logger.log(
      `Processing data export job (exportId=${exportId}, userId=${userId}, attempts=${currentAttempts})`,
    );

    try {
      await this.dataExportService.processDataExport(exportId, userId);
      // Record that this key has been processed
      const key = job.data?.idempotencyKey;
      if (key) {
        this.recordProcessedKey(key);
      }
      return;
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : String(error ?? 'Unknown error');
      const nextAttempts = currentAttempts + 1;

      if (nextAttempts >= DEAD_LETTER_ATTEMPTS_LIMIT) {
        // Max retry attempts exceeded - signal job failure for dead-letter handling
        const descriptiveError = [
          'Data export job reached max retry attempts',
          `(queueJobId=${String(job.id)})`,
          `(attempts=${String(nextAttempts)})`,
          `(exportId=${exportId})`,
          `(reason=${reason})`,
        ]
          .filter(Boolean)
          .join(' ');

        this.logger.warn(descriptiveError);
        // Re-throw so BullMQ can move the job to the dead-letter queue
        // based on the worker's deadLetterTopic configuration, or the
        // operator can manually intervene via Redis.
        throw new Error(descriptiveError);
      }

      const descriptiveError = `Data export job failed (exportId=${exportId}, userId=${userId}, attempts=${nextAttempts}): ${reason}`;

      try {
        await this.loggingService.log({
          level: 'ERROR',
          action: 'DATA_EXPORT_JOB_FAILED',
          message: descriptiveError,
          userId,
          metadata: {
            queue: job.queueName,
            jobId: job.id,
            exportId,
            userId,
            reason,
            attempts: nextAttempts,
          },
        });
      } catch {
        // Ignore logging service errors
      }

      this.logger.error(descriptiveError);
      throw new Error(descriptiveError);
    }
  }
}