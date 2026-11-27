import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '../../logging/logging.module';
import { DataExportModule } from '../../users/data-export/data-export.module';
import { QueueInfrastructureModule } from './queue-infrastructure.module';
import { DataExportCleanupProcessor } from '../processors/data-export-cleanup.processor';
import { DataExportProcessor } from '../processors/data-export.processor';
import { DataExportWorker } from '../workers/data-export.worker';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DataExportModule,
    QueueInfrastructureModule,
  ],
  providers: [
    DataExportProcessor,
    DataExportWorker,
    DataExportCleanupProcessor,
  ],
  exports: [DataExportProcessor, DataExportCleanupProcessor],
})
export class DataExportQueueModule {}
