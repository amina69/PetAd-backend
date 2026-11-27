import { Test, TestingModule } from '@nestjs/testing';
import { AdminStatsService } from './admin-stats.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TtlCacheService } from '../../common/cache/ttl-cache.service';

describe('AdminStatsService', () => {
  let service: AdminStatsService;
  let prisma: {
    adoption: { count: jest.Mock };
    escrow: { count: jest.Mock };
    document: { count: jest.Mock };
    user: { count: jest.Mock };
  };
  let cache: TtlCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = {
      adoption: { count: jest.fn().mockResolvedValue(12) },
      escrow: { count: jest.fn().mockResolvedValue(3) },
      document: { count: jest.fn().mockResolvedValue(7) },
      user: { count: jest.fn().mockResolvedValue(21) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStatsService,
        TtlCacheService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminStatsService);
    cache = module.get(TtlCacheService);
    cache.clear();
  });

  it('returns all four counts in one snapshot', async () => {
    const result = await service.getStats([
      'pendingApprovals',
      'openDisputes',
      'documentsAwaitingVerification',
      'newUsers',
    ]);

    expect(result).toMatchObject({
      pendingApprovals: 12,
      openDisputes: 3,
      documentsAwaitingVerification: 7,
      newUsers: 21,
    });
    expect(result.generatedAt).toEqual(expect.any(String));
    expect(result.since).toEqual(expect.any(String));
    expect(prisma.adoption.count).toHaveBeenCalledWith({
      where: {
        status: { in: ['REQUESTED', 'PENDING'] },
      },
    });
    expect(prisma.escrow.count).toHaveBeenCalledWith({
      where: { status: 'DISPUTED' },
    });
    expect(prisma.document.count).toHaveBeenCalledWith({
      where: { verificationStatus: 'PENDING' },
    });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: expect.any(Date) as Date },
        deletedAt: null,
      },
    });
  });

  it('only queries the requested sections', async () => {
    const result = await service.getStats(['openDisputes']);

    expect(result).toMatchObject({ openDisputes: 3 });
    expect(result).not.toHaveProperty('pendingApprovals');
    expect(prisma.escrow.count).toHaveBeenCalledTimes(1);
    expect(prisma.adoption.count).not.toHaveBeenCalled();
    expect(prisma.document.count).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('caches snapshots for 30 seconds', async () => {
    const first = await service.getStats(['openDisputes']);
    const second = await service.getStats(['openDisputes']);

    expect(second).toEqual(first);
    expect(prisma.escrow.count).toHaveBeenCalledTimes(1);
  });
});
