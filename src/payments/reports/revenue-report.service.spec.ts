import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RevenueFormat, RevenueGroupBy } from './dto/revenue-report-query.dto';
import { RevenueReportService } from './revenue-report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { PaymentLedgerService } from '../ledger/payment-ledger.service';
import { RevenueReportQueueService } from './revenue-report.queue.service';

describe('RevenueReportService', () => {
  let service: RevenueReportService;

  const seeded = [
    {
      type: 'FEE_COLLECTED',
      amount: { toNumber: () => 10 },
      currency: 'XLM',
      occurredAt: new Date('2026-01-02T10:00:00.000Z'),
    },
    {
      type: 'FEE_COLLECTED',
      amount: { toNumber: () => 5 },
      currency: 'USDC',
      occurredAt: new Date('2026-01-02T11:00:00.000Z'),
    },
    {
      type: 'FEE_COLLECTED',
      amount: { toNumber: () => 7 },
      currency: 'XLM',
      occurredAt: new Date('2026-01-09T11:00:00.000Z'),
    },
    {
      type: 'FEE_REFUNDED',
      amount: { toNumber: () => 3 },
      currency: 'XLM',
      occurredAt: new Date('2026-01-09T12:00:00.000Z'),
    },
  ];

  const mockLedger = { findEntries: jest.fn() };
  const mockQueue = { enqueueRevenueReport: jest.fn() };
  const mockLogging = { log: jest.fn() };
  const mockPrisma = { revenueReportJob: { create: jest.fn(), findUnique: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLedger.findEntries.mockResolvedValue(seeded);
    mockPrisma.revenueReportJob.create.mockImplementation(async ({ data }) => ({
      id: 'job-1',
      ...data,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevenueReportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentLedgerService, useValue: mockLedger },
        { provide: RevenueReportQueueService, useValue: mockQueue },
        { provide: ConfigService, useValue: { get: jest.fn(() => 366) } },
        { provide: LoggingService, useValue: mockLogging },
      ],
    }).compile();

    service = module.get(RevenueReportService);
  });

  const params = {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-31T23:59:59.999Z'),
    groupBy: RevenueGroupBy.DAY,
    format: RevenueFormat.JSON,
  };

  it('reconciles totals with the seeded payments ledger by currency', async () => {
    const report = await service.generate(params);

    expect(report.totals).toEqual({
      feesCollected: 22,
      refunds: 3,
      net: 19,
    });
    expect(report.byCurrency).toEqual([
      { currency: 'USDC', feesCollected: 5, refunds: 0, net: 5 },
      { currency: 'XLM', feesCollected: 17, refunds: 3, net: 14 },
    ]);
    expect(report.rows).toHaveLength(3);
  });

  it('groups by ISO week and month', async () => {
    const weekly = await service.generate({ ...params, groupBy: RevenueGroupBy.WEEK });
    expect([...new Set(weekly.rows.map((row) => row.period))]).toEqual([
      '2025-12-29',
      '2026-01-05',
    ]);

    const monthly = await service.generate({ ...params, groupBy: RevenueGroupBy.MONTH });
    expect([...new Set(monthly.rows.map((row) => row.period))]).toEqual(['2026-01']);
  });

  it('produces CSV with neutralised formula cells', async () => {
    mockLedger.findEntries.mockResolvedValueOnce([
      {
        type: 'FEE_COLLECTED',
        amount: { toNumber: () => 10 },
        currency: '=HYPERLINK("evil")',
        occurredAt: new Date('2026-01-02T10:00:00.000Z'),
      },
    ]);

    const report = await service.generate({ ...params, format: RevenueFormat.CSV });

    expect(report.csv).toContain("'=HYPERLINK(");
    expect(report.csv).not.toContain(',=HYPERLINK');
  });

  it('runs large ranges as async jobs', async () => {
    const result = await service.request(
      { ...params, to: new Date('2028-01-01T00:00:00.000Z') },
      'admin-1',
    );

    expect(result.status).toBe('ACCEPTED');
    expect(mockPrisma.revenueReportJob.create).toHaveBeenCalledTimes(1);
    expect(mockQueue.enqueueRevenueReport).toHaveBeenCalledWith({ jobId: 'job-1' });
    expect(mockLogging.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REVENUE_REPORT_ENQUEUED' }),
    );
  });
});
