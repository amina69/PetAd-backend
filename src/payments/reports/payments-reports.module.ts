import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoggingModule } from '../../logging/logging.module';
import { PaymentLedgerService } from '../ledger/payment-ledger.service';
import { RevenueReportController } from './revenue-report.controller';
import { RevenueReportService } from './revenue-report.service';
import { RevenueReportQueueService } from './revenue-report.queue.service';
import { RevenueReportProcessor } from './processors/revenue-report.processor';
import { RevenueReportWorker } from './workers/revenue-report.worker';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [RevenueReportController],
  providers: [
    PaymentLedgerService,
    RevenueReportService,
    RevenueReportQueueService,
    RevenueReportProcessor,
    RevenueReportWorker,
  ],
  exports: [PaymentLedgerService, RevenueReportService],
})
export class PaymentsReportsModule {}
