import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DataExportService } from './data-export.service';
import { PrivateStorageService } from './private-storage.service';
import { DataExportQueueService } from './data-export-queue.service';
import { QueueInfrastructureModule } from '../../jobs/queues/queue-infrastructure.module';

@Module({
  imports: [ConfigModule, PrismaModule, QueueInfrastructureModule],
  providers: [DataExportService, PrivateStorageService, DataExportQueueService],
  exports: [DataExportService, PrivateStorageService, DataExportQueueService],
})
export class DataExportModule {}
