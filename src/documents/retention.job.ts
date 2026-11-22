import { Injectable, Logger } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import * as crypto from 'crypto';

@Injectable()
export class DocumentRetentionJob {
  private readonly logger = new Logger(DocumentRetentionJob.name);

  constructor(private readonly documentsService: DocumentsService) {}

  async handleCron() {
    this.logger.log('Running document retention and deletion job...');
    try {
      const result = await this.documentsService.purgeExpiredDocuments();
      this.logger.log(
        `Document retention job completed. Purged: ${result.purgedCount}, Tombstoned: ${result.tombstonedCount}`,
      );
    } catch (error: any) {
      this.logger.error(`Document retention job failed: ${error.message}`, error.stack);
    }
  }
}
