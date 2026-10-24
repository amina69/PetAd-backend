import { Injectable, Logger } from '@nestjs/common';
import { DataExportService } from '../../users/data-export/data-export.service';

@Injectable()
export class DataExportCleanupProcessor {
  private readonly logger = new Logger(DataExportCleanupProcessor.name);

  constructor(private readonly dataExportService: DataExportService) {}

  async process(): Promise<number> {
    this.logger.log('Running data export cleanup job for expired files');
    const purgedCount = await this.dataExportService.cleanupExpiredExports();
    this.logger.log(`Cleanup completed. Purged ${purgedCount} export files.`);
    return purgedCount;
  }
}
