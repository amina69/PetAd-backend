import { Test, TestingModule } from '@nestjs/testing';
import {
  AdoptionStatus,
  CustodyStatus,
  EventEntityType,
  EventType,
  Prisma,
} from '@prisma/client';
import { EventReplayService } from './event-replay.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { createStrictReadOnlyPrisma } from './strict-prisma.proxy';

// ─── strict-prisma proxy behavior ───────────────────────────────────────

describe('createStrictReadOnlyPrisma (recursive Proxy)', () => {
  it('blocks writes on the top level', () => {
    const fake = {
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      $transaction: jest.fn(),
    };
    const safe = createStrictReadOnlyPrisma(fake as unknown as PrismaService);
    expect(() => (safe as any).$executeRaw()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).$executeRawUnsafe()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).$transaction()).toThrow(/Dry-run mode/);
  });

  it('blocks nested model writes like safe.adoption.create()', () => {
    const fake = {
      adoption: {
        create: jest.fn().mockReturnValue('leaked'),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const safe = createStrictReadOnlyPrisma(fake as unknown as PrismaService);

    expect(() => (safe as any).adoption.create()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).adoption.update()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).adoption.delete()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).adoption.deleteMany()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).adoption.upsert()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).adoption.createMany()).toThrow(/Dry-run mode/);
    expect(() => (safe as any).adoption.updateMany()).toThrow(/Dry-run mode/);

    // Nested reads pass through.
    const readSpy = jest.fn().mockReturnValue('read-ok');
    const fake2 = { pet: { findUnique: readSpy } };
    const safe2 = createStrictReadOnlyPrisma(fake2 as unknown as PrismaService);
    expect((safe2 as any).pet.findUnique()).toBe('read-ok');
    expect(readSpy).toHaveBeenCalled();
  });

  it('blocks deeply-nested tx client writes', () => {
    // Simulates what Prisma passes as the tx client inside $transaction.
    const fake = {
      adoption: { create: jest.fn(), update: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const safe = createStrictReadOnlyPrisma(fake as unknown as PrismaService);
    const tx = safe;
    expect(() => (tx as any).adoption.create()).toThrow(/Dry-run mode/);
    expect(() => (tx as any).adoption.update()).toThrow(/Dry-run mode/);
    expect(() => (tx as any).$executeRaw()).toThrow(/Dry-run mode/);
  });
});

// ─── EventReplayService ─────────────────────────────────────────────────

describe('EventReplayService', () => {
  let service: EventReplayService;
  let prisma: any;
  let loggingService: { log: jest.Mock };

  const adoptionEvents = [
    {
      id: 'ev-1',
      eventType: EventType.ADOPTION_REQUESTED,
      payload: {} as Prisma.JsonValue,
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'ev-2',
      eventType: EventType.ADOPTION_APPROVED,
      payload: {} as Prisma.JsonValue,
      createdAt: new Date('2026-01-02'),
    },
    {
      id: 'ev-3',
      eventType: EventType.ADOPTION_COMPLETED,
      payload: {} as Prisma.JsonValue,
      createdAt: new Date('2026-01-03'),
    },
  ];

  beforeEach(async () => {
    prisma = {
      eventLog: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      adoption: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      custody: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      escrow: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      pet: {
        findUnique: jest.fn(),
      },
      appLog: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    loggingService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReplayService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggingService, useValue: loggingService },
      ],
    }).compile();

    service = module.get<EventReplayService>(EventReplayService);
  });

  describe('aggregate type detection', () => {
    it('throws NotFoundException when no events exist', async () => {
      prisma.eventLog.findFirst.mockResolvedValue(null);
      await expect(
        service.replayAggregate({ aggregateId: 'ghost', dryRun: true }),
      ).rejects.toThrow(/No events found/);
    });

    it('auto-detects aggregateType from the first event', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-1',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.COMPLETED,
      });
      const result = await service.replayAggregate({
        aggregateId: 'a-1',
        dryRun: true,
      });
      expect(result.aggregateType).toBe(EventEntityType.ADOPTION);
    });
  });

  describe('dry-run safety (issue #146)', () => {
    it('dry run never writes via the proxy, even when DB would be divergent', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-1',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.PENDING, // divergent
      });

      const result = await service.replayAggregate({
        aggregateId: 'a-1',
        dryRun: true,
        actorId: 'admin-1',
      });

      expect(result.appliedToDb).toBe(false);
      // The strict proxy blocks any write — service never reaches
      // $transaction or any model update method.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adoption.update).not.toHaveBeenCalled();
      expect(prisma.appLog.create).not.toHaveBeenCalled();
      // Audit goes through the logging service in dry runs.
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_REPLAY_DRY_RUN',
          userId: 'admin-1',
        }),
      );
    });

    it('writing in dry-run mode through the strict proxy throws', () => {
      const fake = { adoption: { create: jest.fn() } };
      const safe = createStrictReadOnlyPrisma(fake as unknown as PrismaService);
      expect(() => (safe as any).adoption.create()).toThrow(/Dry-run mode/);
    });
  });

  describe('discrepancy detection', () => {
    it('lists discrepancies when replayed state differs from current DB', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-1',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.APPROVED,
      });
      const result = await service.replayAggregate({
        aggregateId: 'a-1',
        dryRun: true,
      });
      expect(result.eventsProcessed).toBe(3);
      expect(result.replayedState).toEqual({
        status: AdoptionStatus.COMPLETED,
      });
      expect(result.discrepancies).toContain(
        'status: replayed=COMPLETED, current=APPROVED',
      );
    });

    it('reports no discrepancies when DB already matches replay', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-2',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.COMPLETED,
      });
      const result = await service.replayAggregate({
        aggregateId: 'a-2',
        dryRun: true,
      });
      expect(result.discrepancies).toEqual([]);
      expect(result.appliedToDb).toBe(false);
    });
  });

  describe('upToSequence (event slicing)', () => {
    it('only replays the first N events', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-3',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.APPROVED,
      });
      const result = await service.replayAggregate({
        aggregateId: 'a-3',
        dryRun: true,
        upToSequence: 2,
      });
      expect(result.eventsProcessed).toBe(2);
      expect(result.replayedState).toEqual({ status: AdoptionStatus.APPROVED });
      expect(result.discrepancies).toEqual([]);
    });
  });

  describe('live apply via $transaction + audit-inside-tx', () => {
    it('writes corrected state AND audit row inside the same transaction', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-4',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.APPROVED, // divergent
      });

      const txUpdate = jest.fn().mockResolvedValue({});
      const txAppLogCreate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(
        async (cb: (tx: any) => Promise<unknown>) =>
          await cb({
            adoption: { update: txUpdate },
            appLog: { create: txAppLogCreate },
          }),
      );

      const result = await service.replayAggregate({
        aggregateId: 'a-4',
        dryRun: false,
        actorId: 'admin-9',
      });

      expect(result.appliedToDb).toBe(false);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledWith({
        where: { id: 'a-4' },
        data: { status: AdoptionStatus.COMPLETED },
      });
      // Audit row was written via tx.appLog (NOT regular prisma.appLog).
      expect(prisma.appLog.create).not.toHaveBeenCalled();
      expect(txAppLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ADMIN_REPLAY_APPLIED',
          level: 'WARN',
          userId: 'admin-9',
          metadata: expect.objectContaining({
            aggregateId: 'a-4',
            aggregateType: EventEntityType.ADOPTION,
            dryRun: false,
            appliedToDb: true,
          }),
        }),
      });
      expect(loggingService.log).not.toHaveBeenCalled();
    });

    it('short-circuits and does NOT throw when target record is missing', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-missing',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue(null);

      const result = await service.replayAggregate({
        aggregateId: 'a-missing',
        dryRun: false,
        actorId: 'admin-x',
      });

      expect(result.appliedToDb).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // Still produces an audit row.
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_REPLAY_NOOP',
          metadata: expect.objectContaining({ recordMissing: true }),
        }),
      );
    });

    it('short-circuits when there are no discrepancies even with dryRun:false', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.ADOPTION,
        entityId: 'a-ok',
      });
      prisma.eventLog.findMany.mockResolvedValue(adoptionEvents);
      prisma.adoption.findUnique.mockResolvedValue({
        status: AdoptionStatus.COMPLETED, // already matches
      });

      const result = await service.replayAggregate({
        aggregateId: 'a-ok',
        dryRun: false,
        actorId: 'admin-x',
      });
      expect(result.appliedToDb).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('custody reducer', () => {
    it('replays CUSTODY_STARTED → CUSTODY_RETURNED', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.CUSTODY,
        entityId: 'c-1',
      });
      prisma.eventLog.findMany.mockResolvedValue([
        {
          id: 'ev-1',
          eventType: EventType.CUSTODY_STARTED,
          payload: {},
          createdAt: new Date('2026-02-01'),
        },
        {
          id: 'ev-2',
          eventType: EventType.CUSTODY_RETURNED,
          payload: {},
          createdAt: new Date('2026-02-15'),
        },
      ]);
      prisma.custody.findUnique.mockResolvedValue({
        status: CustodyStatus.RETURNED,
      });
      const result = await service.replayAggregate({
        aggregateId: 'c-1',
        dryRun: true,
      });
      expect(result.replayedState).toEqual({ status: CustodyStatus.RETURNED });
      expect(result.discrepancies).toEqual([]);
    });
  });

  describe('user trust score reducer — DB baseline is the starting point', () => {
    it('absolute event overrides current trustScore', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.USER,
        entityId: 'u-1',
      });
      prisma.eventLog.findMany.mockResolvedValue([
        {
          id: 'ev-1',
          eventType: EventType.TRUST_SCORE_UPDATED,
          payload: { trustScore: 75 } as Prisma.JsonValue,
          createdAt: new Date('2026-03-01'),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({ trustScore: 50 });
      const result = await service.replayAggregate({
        aggregateId: 'u-1',
        dryRun: true,
      });
      expect(result.replayedState).toEqual({ trustScore: 75 });
      expect(result.discrepancies).toContain(
        'trustScore: replayed=75, current=50',
      );
    });

    it('delta events accumulate on top of DB baseline (NOT 0)', async () => {
      // Two deltas that net to zero — proves the replay starts from the
      // DB baseline (50) rather than resetting to 0.
      const userEvents = [
        {
          id: 'ev-1',
          eventType: EventType.TRUST_SCORE_UPDATED,
          payload: { delta: 5 } as Prisma.JsonValue,
          createdAt: new Date('2026-04-01'),
        },
        {
          id: 'ev-2',
          eventType: EventType.TRUST_SCORE_UPDATED,
          payload: { delta: -5 } as Prisma.JsonValue,
          createdAt: new Date('2026-04-02'),
        },
      ];
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.USER,
        entityId: 'u-2',
      });
      prisma.eventLog.findMany.mockResolvedValue(userEvents);
      prisma.user.findUnique.mockResolvedValue({ trustScore: 50 });

      const result = await service.replayAggregate({
        aggregateId: 'u-2',
        dryRun: true,
      });
      // Replay: 50 + 5 - 5 = 50, matches DB.
      expect(result.replayedState).toEqual({ trustScore: 50 });
      expect(result.discrepancies).toEqual([]);
    });

    it('detects discrepancy when replayed score differs from DB', async () => {
      // DB sits at 55; one delta of +5 from baseline 55 → 60 ≠ 55.
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.USER,
        entityId: 'u-3',
      });
      prisma.eventLog.findMany.mockResolvedValue([
        {
          id: 'ev-1',
          eventType: EventType.TRUST_SCORE_UPDATED,
          payload: { delta: 5 } as Prisma.JsonValue,
          createdAt: new Date('2026-04-01'),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({ trustScore: 55 });

      const result = await service.replayAggregate({
        aggregateId: 'u-3',
        dryRun: true,
      });
      expect(result.replayedState).toEqual({ trustScore: 60 });
      expect(result.discrepancies).toContain(
        'trustScore: replayed=60, current=55',
      );
    });
  });

  describe('pet reducer', () => {
    it('flags discrepancy when PET_REGISTERED event exists but row does not', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.PET,
        entityId: 'p-1',
      });
      prisma.eventLog.findMany.mockResolvedValue([
        {
          id: 'ev-1',
          eventType: EventType.PET_REGISTERED,
          payload: {} as Prisma.JsonValue,
          createdAt: new Date('2026-04-01'),
        },
      ]);
      prisma.pet.findUnique.mockResolvedValue(null);

      const result = await service.replayAggregate({
        aggregateId: 'p-1',
        dryRun: true,
      });
      expect(result.replayedState).toEqual({ registered: true });
      expect(result.discrepancies).toContain(
        'registered: replayed=true, current=false',
      );
    });

    it('never reports appliedToDb:true for PET (read-only reducer), even on divergence', async () => {
      prisma.eventLog.findFirst.mockResolvedValue({
        entityType: EventEntityType.PET,
        entityId: 'p-2',
      });
      prisma.eventLog.findMany.mockResolvedValue([
        {
          id: 'ev-1',
          eventType: EventType.PET_REGISTERED,
          payload: {} as Prisma.JsonValue,
          createdAt: new Date('2026-04-01'),
        },
      ]);
      prisma.pet.findUnique.mockResolvedValue(null);

      const result = await service.replayAggregate({
        aggregateId: 'p-2',
        dryRun: false,
        actorId: 'admin-p',
      });

      // PET aggregates have no writable reducer — must NOT report applied.
      expect(result.appliedToDb).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_REPLAY_READONLY',
          metadata: expect.objectContaining({ hasWritableReducer: false }),
        }),
      );
    });
  });
});
