import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DataExportService } from '../../users/data-export/data-export.service';
import { LoggingService } from '../../logging/logging.service';

export interface DataExportJobPayload {
  exportId: string;
  userId: string;
}

@Injectable()
export class DataExportProcessor {
  private readonly logger = new Logger(DataExportProcessor.name);

  constructor(
    private readonly dataExportService: DataExportService,
    private readonly loggingService: LoggingService,
  ) {}

  async process(job: Job<DataExportJobPayload>): Promise<void> {
    const { exportId, userId } = job.data;
    this.logger.log(
      `Processing data export job (exportId=${exportId}, userId=${userId})`,
    );

    try {
      await this.dataExportService.processDataExport(exportId, userId);
      return;
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : String(error ?? 'Unknown error');
      const descriptiveError = `Data export job failed (exportId=${exportId}, userId=${userId}): ${reason}`;

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
            reason,
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
