import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { FlagsService } from './flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';

describe('FlagsService', () => {
  let service: FlagsService;
  let cache: TtlCacheService;
  let logging: { log: jest.Mock };
  let featureFlag: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    featureFlag = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    logging = { log: jest.fn().mockResolvedValue({ id: 'log-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlagsService,
        TtlCacheService,
        { provide: PrismaService, useValue: { featureFlag } },
        { provide: LoggingService, useValue: logging },
      ],
    }).compile();

    service = module.get(FlagsService);
    cache = module.get(TtlCacheService);
    cache.clear();
  });

  function flag(overrides: Record<string, unknown> = {}) {
    return {
      id: 'flag-1',
      key: 'new-adoption-flow',
      enabled: true,
      rolloutPercentage: 20,
      targetRoles: [],
      description: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('returns false for disabled flags and omits unknown keys', async () => {
    featureFlag.findMany.mockResolvedValueOnce([
      flag({ enabled: false, rolloutPercentage: 100 }),
    ]);

    const result = await service.evaluate({ userId: 'user-1' }, [
      'new-adoption-flow',
      'unknown-flag',
    ]);

    expect(result).toEqual({ 'new-adoption-flow': false });
    expect(featureFlag.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['new-adoption-flow', 'unknown-flag'] } },
      orderBy: { key: 'asc' },
    });
  });

  it('enables roughly 20 percent of 10,000 users deterministically', async () => {
    featureFlag.findMany.mockResolvedValueOnce([flag()]);

    const evaluate = () =>
      service
        .evaluate({ userId: 'user-1' })
        .then((result) => result[flag().key]);
    const first = await evaluate();

    const enabledCount = Array.from({ length: 10_000 }, (_, index) =>
      service['isEnabledFor'](flag(), `user-${index}`),
    ).filter(Boolean).length;

    expect(enabledCount).toBeGreaterThan(1_900);
    expect(enabledCount).toBeLessThan(2_100);
    expect(await evaluate()).toBe(first);
    expect(featureFlag.findMany).toHaveBeenCalledTimes(1);
  });

  it('respects role targeting and anonymous callers', () => {
    const adminOnly = flag({ rolloutPercentage: 100, targetRoles: ['ADMIN'] });

    expect(service['isEnabledFor'](adminOnly, 'u1', 'ADMIN')).toBe(true);
    expect(service['isEnabledFor'](adminOnly, 'u1', 'USER')).toBe(false);
    expect(service['isEnabledFor'](adminOnly, 'u1')).toBe(false);
    expect(
      service['isEnabledFor'](flag({ rolloutPercentage: 100 }), undefined),
    ).toBe(false);
    expect(
      service['isEnabledFor'](
        flag({ rolloutPercentage: 100, targetRoles: [UserRole.USER] }),
        'u1',
        'USER',
      ),
    ).toBe(true);
  });

  it('audits admin writes and invalidates the evaluation cache', async () => {
    featureFlag.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([flag({ rolloutPercentage: 100 })]);
    featureFlag.create.mockResolvedValueOnce(flag({ rolloutPercentage: 100 }));

    await service.evaluate({ userId: 'user-1' });
    await service.create(
      {
        key: 'new-adoption-flow',
        enabled: true,
        rolloutPercentage: 100,
      },
      'admin-1',
    );
    const result = await service.evaluate({ userId: 'user-1' });

    expect(result['new-adoption-flow']).toBe(true);
    expect(featureFlag.findMany).toHaveBeenCalledTimes(2);
    expect(logging.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FEATURE_FLAG_CREATED',
        userId: 'admin-1',
      }),
    );
  });
});
