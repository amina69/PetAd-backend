import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from '../email/email.module';
import { LoggingModule } from '../logging/logging.module';
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationWorker } from './workers/notification.worker';
import { NotificationQueueService } from './services/notification-queue.service';
import { NotificationMetricsService } from './services/notification-metrics.service';
import { NotificationDeadLetterService } from './services/notification-dead-letter.service';
import { DataExportProcessor } from './processors/data-export.processor';
import { DataExportWorker } from './workers/data-export.worker';
import { DataExportCleanupProcessor } from './processors/data-export-cleanup.processor';
import { DataExportModule } from '../users/data-export/data-export.module';

@Global()
@Module({
  imports: [
    ConfigModule, // Provides ConfigService to our queue/worker services
    EmailModule,
    LoggingModule,
    DataExportModule,
  ],
  providers: [
    NotificationProcessor,
    NotificationQueueService,
    NotificationMetricsService,
    NotificationDeadLetterService,
    NotificationWorker,
    DataExportProcessor,
    DataExportWorker,
    DataExportCleanupProcessor,
  ],
  exports: [
    NotificationQueueService,
    NotificationMetricsService,
    NotificationDeadLetterService,
    DataExportProcessor,
    DataExportCleanupProcessor,
  ],
})
export class JobsModule {}
