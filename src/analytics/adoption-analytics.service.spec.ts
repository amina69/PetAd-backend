import { PrismaService } from '../prisma/prisma.service';
import { AdoptionAnalyticsService } from './adoption-analytics.service';

describe('AdoptionAnalyticsService', () => {
  const queryRaw = jest.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const service = new AdoptionAnalyticsService(prisma);

  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw
      .mockResolvedValueOnce([
        {
          requested_raw: 10,
          approved_count: 12,
          funded_count: 8,
          completed_count: 9,
          rejected: 2,
          cancelled: 1,
          expired: 3,
          requested_to_approved: 86_400,
          approved_to_funded: 172_800,
          funded_to_completed: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          species: 'DOG',
          age_band: 'YOUNG',
          size: 'MEDIUM',
          requested: 4,
          completed: 3,
        },
      ])
      .mockResolvedValueOnce([{ completed: 9, successful: 7 }]);
  });

  it('clamps funnel counts so every stage is monotonic', async () => {
    const result = await service.getFunnel({ windowDays: 30 });

    expect(result.stages.map((stage) => stage.count)).toEqual([10, 10, 8, 8]);
    expect(result.stages.map((stage) => stage.conversionRate)).toEqual([
      100, 100, 80, 80,
    ]);
  });

  it('computes median stage durations in SQL and reports drop-offs', async () => {
    const result = await service.getFunnel();

    expect(queryRaw.mock.calls[0][0].text).toContain('percentile_cont');
    expect(queryRaw.mock.calls[0][0].text).toContain('LEAST');
    expect(result.medians).toEqual([
      { from: 'REQUESTED', to: 'APPROVED', medianDays: 1 },
      { from: 'APPROVED', to: 'FUNDED', medianDays: 2 },
      { from: 'FUNDED', to: 'COMPLETED', medianDays: null },
    ]);
    expect(result.dropOffs).toEqual([
      { reason: 'REJECTED', count: 2, rate: 20 },
      { reason: 'CANCELLED', count: 1, rate: 10 },
      { reason: 'EXPIRED', count: 3, rate: 30 },
    ]);
  });

  it('includes species, age and size breakdowns from the read model', async () => {
    const result = await service.getFunnel();

    const breakdownSql = queryRaw.mock.calls[1][0].text as string;
    expect(breakdownSql).toContain('daily_adoptions');
    expect(breakdownSql).not.toContain('JOIN adoptions');
    expect(breakdownSql).not.toContain('JOIN pets');
    expect(result.breakdown).toEqual([
      {
        species: 'DOG',
        ageBand: 'YOUNG',
        size: 'MEDIUM',
        requested: 4,
        completed: 3,
        completionRate: 75,
      },
    ]);
  });

  it('documents success as completed without a 30-day return', async () => {
    const result = await service.getFunnel();

    expect(result.success).toEqual({
      completed: 9,
      successful: 7,
      definition: 'Completed and not returned or cancelled within 30 days',
    });
    expect(result.successDefinition).toBe(result.success.definition);
  });

  it('handles an empty ledger without dividing by zero', async () => {
    queryRaw.mockReset();
    queryRaw
      .mockResolvedValueOnce([
        {
          requested_raw: 0,
          approved_count: 0,
          funded_count: 0,
          completed_count: 0,
          rejected: 0,
          cancelled: 0,
          expired: 0,
          requested_to_approved: null,
          approved_to_funded: null,
          funded_to_completed: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ completed: 0, successful: 0 }]);

    const result = await service.getFunnel();
    expect(result.stages.every((stage) => stage.conversionRate === 0)).toBe(true);
    expect(result.breakdown).toEqual([]);
  });
});
