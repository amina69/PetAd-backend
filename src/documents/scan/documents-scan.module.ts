import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';
import { ClamAVScanner } from './clamav.scanner';
import { DocumentScanProcessor } from './document-scan.processor';
import { DocumentScanQueueService } from './document-scan.queue.service';
import { SCANNER_TOKEN } from './scanner.interface';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    EmailModule,
    BullModule.registerQueue({ name: 'document-scan' }),
    BullModule.registerQueue({
      name: 'document-scanning',
    }),
  ],
  providers: [
    {
      provide: SCANNER_TOKEN,
      useClass: ClamAVScanner,
    },
    DocumentScanProcessor,
    DocumentScanQueueService,
  ],
  exports: [DocumentScanQueueService, SCANNER_TOKEN, DocumentScanProcessor],
})
export class DocumentsScanModule {}
