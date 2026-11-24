import { Test, TestingModule } from '@nestjs/testing';
import {
  DisputeEntityType,
  DisputeReason,
  DisputeStatus,
} from '@prisma/client';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  dispute: {
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
};

function dispute(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    status: DisputeStatus.OPEN,
    reason: DisputeReason.NO_SHOW,
    entityType: DisputeEntityType.ADOPTION,
    entityId: 'a1',
    description: null,
    raisedById: 'u1',
    respondentId: 'u2',
    assigneeId: null,
    resolvedAt: null,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
    raisedBy: { id: 'u1', firstName: 'A', lastName: 'B' },
    respondent: { id: 'u2', firstName: 'C', lastName: 'D' },
    assignee: null,
    ...overrides,
  };
}

describe('DisputesService', () => {
  let service: DisputesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.dispute.findMany.mockResolvedValue([dispute()]);
    mockPrisma.dispute.count.mockResolvedValue(1);
    mockPrisma.dispute.groupBy.mockResolvedValue([
      { status: DisputeStatus.OPEN, _count: { _all: 1 } },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(DisputesService);
  });

  it('restricts a party to disputes they raised or are the respondent of', async () => {
    await service.list({ userId: 'u1', role: 'USER' }, {});

    expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [{ raisedById: 'u1' }, { respondentId: 'u1' }],
            },
          ],
        },
      }),
    );
    expect(mockPrisma.dispute.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [{ OR: [{ raisedById: 'u1' }, { respondentId: 'u1' }] }],
      }) as unknown,
    });
  });

  it('does not restrict an admin', async () => {
    await service.list({ userId: 'admin', role: 'ADMIN' }, {});

    expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [] } }),
    );
  });

  it('returns counts for every status, seeded with zero', async () => {
    mockPrisma.dispute.groupBy.mockResolvedValue([
      { status: DisputeStatus.OPEN, _count: { _all: 2 } },
      { status: DisputeStatus.RESOLVED, _count: { _all: 1 } },
    ]);

    const result = await service.list({ userId: 'admin', role: 'ADMIN' }, {});

    expect(result.counts).toEqual({
      OPEN: 2,
      UNDER_REVIEW: 0,
      RESOLVED: 1,
      REJECTED: 0,
    });
  });

  it('counts over every filter except status so tabs match the filtered set', async () => {
    await service.list(
      { userId: 'admin', role: 'ADMIN' },
      { status: DisputeStatus.OPEN, reason: DisputeReason.NO_SHOW },
    );

    const [[groupByCall]] = mockPrisma.dispute.groupBy.mock
      .calls as unknown as [[{ where: unknown }]];
    expect(groupByCall.where).toEqual({
      AND: [{ reason: DisputeReason.NO_SHOW }],
    });
  });

  it('applies status, reason, entity type and sort to the page query', async () => {
    await service.list(
      { userId: 'admin', role: 'ADMIN' },
      {
        status: DisputeStatus.UNDER_REVIEW,
        reason: DisputeReason.DAMAGE,
        entityType: DisputeEntityType.ESCROW,
        sort: 'updatedAt',
        order: 'asc',
        page: 2,
        limit: 5,
      },
    );

    expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { reason: DisputeReason.DAMAGE },
            { entityType: DisputeEntityType.ESCROW },
            { status: DisputeStatus.UNDER_REVIEW },
          ],
        },
        skip: 5,
        take: 5,
        orderBy: [{ updatedAt: 'asc' }, { id: 'desc' }],
      }),
    );
  });

  it('normalises the date filter to a createdAt range', async () => {
    await service.list(
      { userId: 'admin', role: 'ADMIN' },
      {
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-02-01T00:00:00.000Z',
      },
    );

    expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              createdAt: {
                gte: new Date('2026-01-01T00:00:00.000Z'),
                lte: new Date('2026-02-01T00:00:00.000Z'),
              },
            },
          ],
        },
      }),
    );
  });

  it('adds assignee and age filters for admins', async () => {
    await service.listForAdmin(
      { userId: 'admin', role: 'ADMIN' },
      { assignee: 'me', minAgeDays: 2, maxAgeDays: 10 },
    );

    const [[call]] = mockPrisma.dispute.findMany.mock.calls as unknown as [
      [{ where: { AND: unknown[] } }],
    ];

    expect(call.where.AND).toContainEqual({ assigneeId: 'admin' });
    const createdAt = (
      call.where.AND as { createdAt?: { gte: Date; lte: Date } }[]
    ).find((condition) => condition.createdAt)?.createdAt;

    expect(createdAt?.gte).toBeInstanceOf(Date);
    expect(createdAt?.lte).toBeInstanceOf(Date);
    expect((createdAt?.lte as Date).getTime()).toBeLessThan(Date.now());
  });

  it('supports the unassigned assignee filter', async () => {
    await service.listForAdmin(
      { userId: 'admin', role: 'ADMIN' },
      { assignee: 'unassigned' },
    );

    const [[call]] = mockPrisma.dispute.findMany.mock.calls as unknown as [
      [{ where: { AND: unknown[] } }],
    ];
    expect(call.where.AND).toContainEqual({ assigneeId: null });
  });

  it('adds ageDays to each dispute', async () => {
    const result = await service.list({ userId: 'admin', role: 'ADMIN' }, {});
    expect(result.data[0].ageDays).toBeGreaterThanOrEqual(2);
  });
});
