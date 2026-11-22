import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

@Injectable()
export class DocumentScanQueueService {
  private readonly logger = new Logger(DocumentScanQueueService.name);

  constructor(@InjectQueue('document-scanning') private readonly scanQueue: Queue) {}

  async enqueueScan(documentId: string, filePath?: string, fileBuffer?: string) {
    await this.scanQueue.add(
      'scan',
      { documentId, filePath, fileBuffer },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
      },
    );
    this.logger.log(`Enqueued document ${documentId} for malware scanning`);
  }
}
