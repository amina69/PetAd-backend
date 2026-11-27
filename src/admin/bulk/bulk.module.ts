import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggingModule } from '../../logging/logging.module';
import { AdoptionModule } from '../../adoption/adoption.module';
import { AdminBulkController } from './bulk.controller';
import { BulkActionsService } from './services/bulk-actions.service';
import { CsvExportService } from './services/csv-export.service';

@Module({
  imports: [PrismaModule, LoggingModule, AdoptionModule],
  controllers: [AdminBulkController],
  providers: [BulkActionsService, CsvExportService],
  exports: [BulkActionsService, CsvExportService],
})
export class AdminBulkModule {}
