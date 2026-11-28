import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from '../email/email.module';
import { LoggingModule } from '../logging/logging.module';
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationWorker } from './workers/notification.worker';
import { NotificationQueueService } from './services/notification-queue.service';
import { DataExportProcessor } from './processors/data-export.processor';
import { DataExportWorker } from './workers/data-export.worker';
import { DataExportCleanupProcessor } from './processors/data-export-cleanup.processor';
import { DataExportModule } from '../users/data-export/data-export.module';
import { AnchoringQueueService } from './services/anchoring-queue.service';
import { AnchoringProcessor } from './processors/anchoring.processor';
import { AnchoringWorker } from './workers/anchoring.worker';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueInfrastructureModule } from './queues/queue-infrastructure.module';
import { QueueGroupsModule } from './queues/queue-groups.module';

@Global()
@Module({
imports: [
    ConfigModule,
    EmailModule,
    LoggingModule,
    DataExportModule,
    PrismaModule,
    QueueInfrastructureModule,
    QueueGroupsModule,
  ],
  providers: [
    NotificationProcessor,
    NotificationQueueService,
    NotificationWorker,
    DataExportProcessor,
    DataExportWorker,
    DataExportCleanupProcessor,
    AnchoringQueueService,
    AnchoringProcessor,
    AnchoringWorker,
  ],
  exports: [
    NotificationQueueService,
    DataExportProcessor,
    DataExportCleanupProcessor,
    AnchoringQueueService,
    AnchoringProcessor,
    QueueInfrastructureModule,
    QueueGroupsModule,
  ],
})
export class JobsModule {}
