import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RevenueFormat,
  RevenueGroupBy,
} from '../dto/revenue-report-query.dto';
import { RevenueReportService } from '../revenue-report.service';

@Injectable()
export class RevenueReportProcessor {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RevenueReportService))
    private readonly reports: RevenueReportService,
  ) {}

  async process(payload: { jobId: string }): Promise<void> {
    const job = await this.prisma.revenueReportJob.findUnique({
      where: { id: payload.jobId },
    });
    if (!job || job.status !== 'PENDING') return;

    await this.prisma.revenueReportJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' },
    });

    try {
      const report = await this.reports.generate({
        from: job.fromDate,
        to: job.toDate,
        groupBy: job.groupBy as RevenueGroupBy,
        format: job.format as RevenueFormat,
      });

      await this.prisma.revenueReportJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          result: report as object,
          csvContent: report.csv ?? null,
        },
      });
    } catch (error) {
      await this.prisma.revenueReportJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}
