import { PrismaService } from '../../prisma/prisma.service';
import { DailyAggregatesProjectionService } from './daily-aggregates.projection';

describe('DailyAggregatesProjectionService', () => {
  const executeRaw = jest.fn();
  const queryRaw = jest.fn();
  const findUnique = jest.fn();
  const stateUpsert = jest.fn();
  const upserts = {
    dailyAdoption: { upsert: jest.fn() },
    dailyCustody: { upsert: jest.fn() },
    dailyDispute: { upsert: jest.fn() },
    dailyUser: { upsert: jest.fn() },
  };
  const tx = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    dailyAdoption: upserts.dailyAdoption,
    dailyCustody: upserts.dailyCustody,
    dailyDispute: upserts.dailyDispute,
    dailyUser: upserts.dailyUser,
    analyticsProjectionState: { upsert: stateUpsert },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    analyticsProjectionState: { findUnique },
  } as unknown as PrismaService;
  const service = new DailyAggregatesProjectionService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw
      .mockResolvedValueOnce([
        {
          day: new Date('2026-01-02T00:00:00.000Z'),
          species: 'DOG',
          age_band: 'YOUNG',
          size: 'MEDIUM',
          region: 'NY',
          shelter_id: 'shelter-1',
          requested: 2,
          approved: 1,
          funded: 1,
          completed: 1,
          rejected: 0,
          cancelled: 0,
          expired: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          day: new Date('2026-01-02T00:00:00.000Z'),
          species: 'DOG',
          region: 'NY',
          shelter_id: 'shelter-1',
          created: 1,
          started: 1,
          completed: 0,
          returned: 0,
          cancelled: 0,
          violation: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          day: new Date('2026-01-02T00:00:00.000Z'),
          species: 'DOG',
          region: 'NY',
          shelter_id: 'shelter-1',
          opened: 1,
          resolved: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          day: new Date('2026-01-02T00:00:00.000Z'),
          region: 'NY',
          shelter_id: 'UNKNOWN',
          registered: 3,
          suspended: 0,
          reinstated: 0,
          deleted: 0,
        },
      ]);
  });

  it('rebuilds all four read models from raw ledger rows in one transaction', async () => {
    const from = new Date('2026-01-02T00:00:00.000Z');
    const to = new Date('2026-01-03T00:00:00.000Z');
    const state = await service.rebuildRange(from, to);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(4);
    expect(queryRaw).toHaveBeenCalledTimes(4);

    expect(upserts.dailyAdoption.upsert).toHaveBeenCalledWith({
      where: {
        date_species_ageBand_size_region_shelterId: {
          date: from,
          species: 'DOG',
          ageBand: 'YOUNG',
          size: 'MEDIUM',
          region: 'NY',
          shelterId: 'shelter-1',
        },
      },
      create: expect.objectContaining({ requested: 2, approved: 1 }),
      update: expect.objectContaining({ completed: 1 }),
    });
    expect(upserts.dailyCustody.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ created: 1, started: 1 }),
      }),
    );
    expect(upserts.dailyDispute.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ opened: 1, resolved: 1 }),
      }),
    );
    expect(upserts.dailyUser.upsert).toHaveBeenCalledWith({
      where: {
        date_region_shelterId: {
          date: from,
          region: 'NY',
          shelterId: 'UNKNOWN',
        },
      },
      create: expect.objectContaining({ registered: 3 }),
      update: expect.objectContaining({ registered: 3 }),
    });
    expect(state.rowCount).toBe(4);
    expect(state.lastProcessedAt).toEqual(to);
    expect(state.refreshIntervalSeconds).toBe(300);
  });

  it('reports projection lag and interval', async () => {
    findUnique.mockResolvedValueOnce({
      key: 'daily_aggregates',
      lastProcessedAt: new Date(Date.now() - 60_000),
      lastRunAt: new Date(),
      rowCount: 10,
    });

    const state = await service.getState();

    expect(state.refreshLagSeconds).toBeGreaterThanOrEqual(60);
    expect(state.refreshIntervalSeconds).toBe(300);
    expect(state.rowCount).toBe(10);
  });

  it('refreshes once every five minutes', () => {
    jest.useFakeTimers();
    const refresh = jest
      .spyOn(service, 'refreshStaleDay')
      .mockResolvedValue(undefined);

    service.onModuleInit();
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockRestore();
    jest.useRealTimers();
  });
});
