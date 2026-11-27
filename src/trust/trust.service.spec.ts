import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TrustEventKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { TRUST_ALGORITHM_VERSION, TrustService } from './trust.service';

describe('TrustService (BE-141)', () => {
  let service: TrustService;

  const mockTx = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    eventLog: {
      findUnique: jest.fn(),
    },
    trustEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    trustScoreHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    trustSummary: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockPrisma = {
    ...mockTx,
    $transaction: jest.fn((callback: (tx: typeof mockTx) => Promise<unknown>) =>
      callback(mockTx),
    ),
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEventsService },
      ],
    }).compile();

    service = module.get<TrustService>(TrustService);
  });

  it('rejects a trust event without a sourceEventId', async () => {
    await expect(
      service.recordTrustEvent({
        userId: 'user-1',
        kind: TrustEventKind.AGREEMENT_COMPLETED,
        weight: 10,
        sourceEventId: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a trust event when the referenced domain EventLog does not exist', async () => {
    mockTx.user.findUnique.mockResolvedValue({ id: 'user-1', trustScore: 50 });
    mockTx.eventLog.findUnique.mockResolvedValue(null);

    await expect(
      service.recordTrustEvent({
        userId: 'user-1',
        kind: TrustEventKind.DOCUMENT_VERIFIED,
        weight: 5,
        sourceEventId: 'missing-event',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockTx.trustEvent.create).not.toHaveBeenCalled();
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it('rejects a trust event when the user does not exist', async () => {
    mockTx.user.findUnique.mockResolvedValue(null);
    mockTx.eventLog.findUnique.mockResolvedValue({ id: 'evt-1' });

    await expect(
      service.recordTrustEvent({
        userId: 'missing-user',
        kind: TrustEventKind.REVIEW_RECEIVED,
        weight: 4,
        sourceEventId: 'evt-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockTx.trustEvent.create).not.toHaveBeenCalled();
  });

  it('appends TrustEvent, TrustScoreHistory, upserts TrustSummary, and updates cached User.trustScore', async () => {
    const at = new Date('2026-11-27T12:00:00.000Z');
    mockTx.user.findUnique.mockResolvedValue({ id: 'user-1', trustScore: 50 });
    mockTx.eventLog.findUnique.mockResolvedValue({ id: 'evt-domain-1' });
    mockTx.trustEvent.create.mockResolvedValue({ id: 'te-1' });
    mockTx.trustScoreHistory.create.mockResolvedValue({ id: 'hist-1' });
    mockTx.trustSummary.upsert.mockResolvedValue({
      userId: 'user-1',
      currentScore: 60,
    });
    mockTx.user.update.mockResolvedValue({ id: 'user-1', trustScore: 60 });

    const result = await service.recordTrustEvent({
      userId: 'user-1',
      kind: TrustEventKind.AGREEMENT_COMPLETED,
      weight: 10,
      sourceEventId: 'evt-domain-1',
      at,
    });

    expect(result).toEqual({
      id: 'user-1',
      trustScore: 60,
      previousScore: 50,
      algorithmVersion: TRUST_ALGORITHM_VERSION,
      trustEventId: 'te-1',
      historyEntryId: 'hist-1',
    });

    expect(mockTx.trustEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        kind: TrustEventKind.AGREEMENT_COMPLETED,
        weight: 10,
        sourceEventId: 'evt-domain-1',
        at,
      },
    });
    expect(mockTx.trustScoreHistory.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        score: 60,
        algorithmVersion: TRUST_ALGORITHM_VERSION,
        computedAt: at,
      },
    });
    const upsertCall = mockTx.trustSummary.upsert.mock.calls[0] as [
      {
        where: { userId: string };
        create: {
          currentScore: number;
          positiveEvents: number;
          negativeEvents: number;
        };
      },
    ];
    expect(upsertCall[0].where).toEqual({ userId: 'user-1' });
    expect(upsertCall[0].create).toMatchObject({
      currentScore: 60,
      positiveEvents: 1,
      negativeEvents: 0,
    });
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { trustScore: 60 },
      select: { id: true, trustScore: true },
    });
  });

  it('clamps computed scores within [0, 100]', async () => {
    mockTx.user.findUnique.mockResolvedValue({ id: 'user-1', trustScore: 10 });
    mockTx.eventLog.findUnique.mockResolvedValue({ id: 'evt-2' });
    mockTx.trustEvent.create.mockResolvedValue({ id: 'te-2' });
    mockTx.trustScoreHistory.create.mockResolvedValue({ id: 'hist-2' });
    mockTx.trustSummary.upsert.mockResolvedValue({
      userId: 'user-1',
      currentScore: 0,
    });
    mockTx.user.update.mockResolvedValue({ id: 'user-1', trustScore: 0 });

    const low = await service.recordTrustEvent({
      userId: 'user-1',
      kind: TrustEventKind.DISPUTE_LOST,
      weight: -30,
      sourceEventId: 'evt-2',
    });
    expect(low.trustScore).toBe(0);

    mockTx.user.findUnique.mockResolvedValue({ id: 'user-1', trustScore: 95 });
    mockTx.user.update.mockResolvedValue({ id: 'user-1', trustScore: 100 });
    const high = await service.recordTrustEvent({
      userId: 'user-1',
      kind: TrustEventKind.DOCUMENT_VERIFIED,
      weight: 20,
      sourceEventId: 'evt-2',
    });
    expect(high.trustScore).toBe(100);
  });

  it('logs a domain EventLog before recording TrustEvent in adjustTrustScore', async () => {
    mockTx.user.findUnique.mockResolvedValue({ id: 'user-1', trustScore: 50 });
    mockEventsService.logEvent.mockResolvedValue({ id: 'evt-generated-1' });
    mockTx.eventLog.findUnique.mockResolvedValue({ id: 'evt-generated-1' });
    mockTx.trustEvent.create.mockResolvedValue({ id: 'te-3' });
    mockTx.trustScoreHistory.create.mockResolvedValue({ id: 'hist-3' });
    mockTx.trustSummary.upsert.mockResolvedValue({
      userId: 'user-1',
      currentScore: 55,
    });
    mockTx.user.update.mockResolvedValue({ id: 'user-1', trustScore: 55 });

    const updated = await service.adjustTrustScore('user-1', 5);

    expect(mockEventsService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'USER',
        entityId: 'user-1',
        eventType: 'TRUST_SCORE_UPDATED',
      }),
    );
    const createCall = mockTx.trustEvent.create.mock.calls[0] as [
      {
        data: {
          sourceEventId: string;
          kind: TrustEventKind;
          weight: number;
        };
      },
    ];
    expect(createCall[0].data).toMatchObject({
      sourceEventId: 'evt-generated-1',
      kind: TrustEventKind.CUSTODY_RETURNED,
      weight: 5,
    });
    expect(updated).toEqual({ id: 'user-1', trustScore: 55 });
  });
});
