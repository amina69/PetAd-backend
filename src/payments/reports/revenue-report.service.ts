import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentLedgerEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { PaymentLedgerService } from '../ledger/payment-ledger.service';
import {
  RevenueFormat,
  RevenueGroupBy,
} from './dto/revenue-report-query.dto';
import { toCsv } from './utils/csv.util';
import { RevenueReportQueueService } from './revenue-report.queue.service';

export interface RevenueReportParams {
  from: Date;
  to: Date;
  groupBy: RevenueGroupBy;
  format: RevenueFormat;
}

export interface RevenueRow {
  period: string;
  currency: string;
  feesCollected: number;
  refunds: number;
  net: number;
}

export interface RevenueReport {
  from: string;
  to: string;
  groupBy: RevenueGroupBy;
  rows: RevenueRow[];
  byCurrency: Array<{
    currency: string;
    feesCollected: number;
    refunds: number;
    net: number;
  }>;
  totals: { feesCollected: number; refunds: number; net: number };
  csv?: string;
}

export type RevenueReportResponse =
  | { status: 'COMPLETE'; report: RevenueReport; csv?: string }
  | { status: 'ACCEPTED'; jobId: string; message: string };

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toAmount = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
};

@Injectable()
export class RevenueReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PaymentLedgerService,
    private readonly queue: RevenueReportQueueService,
    private readonly configService: ConfigService,
    private readonly logging: LoggingService,
  ) {}

  async request(
    params: RevenueReportParams,
    requestedById?: string,
  ): Promise<RevenueReportResponse> {
    if (params.to <= params.from) {
      throw new BadRequestException('`to` must be later than `from`');
    }

    const syncLimitDays =
      this.configService.get<number>('reports.syncLimitDays') ?? 366;
    const rangeDays =
      (params.to.getTime() - params.from.getTime()) / 86_400_000;

    if (rangeDays > syncLimitDays) {
      const job = await this.prisma.revenueReportJob.create({
        data: {
          requestedById,
          fromDate: params.from,
          toDate: params.to,
          groupBy: params.groupBy,
          format: params.format,
          status: 'PENDING',
        },
      });

      await this.queue.enqueueRevenueReport({ jobId: job.id });
      await this.logging.log({
        level: 'INFO',
        action: 'REVENUE_REPORT_ENQUEUED',
        message: `Enqueued revenue report job ${job.id}`,
        userId: requestedById,
        metadata: { jobId: job.id, rangeDays },
      });

      return {
        status: 'ACCEPTED',
        jobId: job.id,
        message:
          'Large date range accepted; poll the job endpoint for completion.',
      };
    }

    const report = await this.generate(params);
    return { status: 'COMPLETE', report, csv: report.csv };
  }

  async generate(params: RevenueReportParams): Promise<RevenueReport> {
    const entries = await this.ledger.findEntries(params.from, params.to);
    const grouped = new Map<
      string,
      { period: string; currency: string; feesCollected: number; refunds: number }
    >();

    for (const entry of entries) {
      const period = this.bucket(entry.occurredAt, params.groupBy);
      const key = `${period}|${entry.currency}`;
      const bucket =
        grouped.get(key) ??
        { period, currency: entry.currency, feesCollected: 0, refunds: 0 };

      const amount = toAmount(entry.amount);
      if (entry.type === PaymentLedgerEntryType.FEE_COLLECTED) {
        bucket.feesCollected += amount;
      } else if (entry.type === PaymentLedgerEntryType.FEE_REFUNDED) {
        bucket.refunds += amount;
      }
      grouped.set(key, bucket);
    }

    const rows: RevenueRow[] = [...grouped.values()]
      .sort(
        (a, b) =>
          a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency),
      )
      .map((bucket) => ({
        period: bucket.period,
        currency: bucket.currency,
        feesCollected: round2(bucket.feesCollected),
        refunds: round2(bucket.refunds),
        net: round2(bucket.feesCollected - bucket.refunds),
      }));

    const byCurrencyMap = new Map<
      string,
      { feesCollected: number; refunds: number }
    >();
    for (const row of rows) {
      const currency =
        byCurrencyMap.get(row.currency) ?? { feesCollected: 0, refunds: 0 };
      currency.feesCollected += row.feesCollected;
      currency.refunds += row.refunds;
      byCurrencyMap.set(row.currency, currency);
    }

    const byCurrency = [...byCurrencyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, totals]) => ({
        currency,
        feesCollected: round2(totals.feesCollected),
        refunds: round2(totals.refunds),
        net: round2(totals.feesCollected - totals.refunds),
      }));

    const totals = byCurrency.reduce(
      (acc, entry) => ({
        feesCollected: round2(acc.feesCollected + entry.feesCollected),
        refunds: round2(acc.refunds + entry.refunds),
        net: round2(acc.net + entry.net),
      }),
      { feesCollected: 0, refunds: 0, net: 0 },
    );

    const report: RevenueReport = {
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      groupBy: params.groupBy,
      rows,
      byCurrency,
      totals,
    };

    if (params.format === RevenueFormat.CSV) {
      report.csv = toCsv([
        ['period', 'currency', 'fees_collected', 'refunds', 'net'],
        ...rows.map((row) => [
          row.period,
          row.currency,
          row.feesCollected,
          row.refunds,
          row.net,
        ]),
        ['TOTAL', '', totals.feesCollected, totals.refunds, totals.net],
      ]);
    }

    return report;
  }

  async getJob(jobId: string) {
    const job = await this.prisma.revenueReportJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Revenue report job ${jobId} not found`);
    }
    return job;
  }

  async getJobCsv(jobId: string): Promise<string> {
    const job = await this.getJob(jobId);
    if (job.status !== 'COMPLETED' || !job.csvContent) {
      throw new NotFoundException(
        `CSV for revenue report job ${jobId} is not available yet`,
      );
    }
    return job.csvContent;
  }

  private bucket(date: Date, groupBy: RevenueGroupBy): string {
    const utc = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    if (groupBy === RevenueGroupBy.MONTH) {
      return utc.toISOString().slice(0, 7);
    }
    if (groupBy === RevenueGroupBy.WEEK) {
      utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
    }
    return utc.toISOString().slice(0, 10);
  }
}
