import { EventEntityType } from '@prisma/client';
import { EventLedgerService } from './event-ledger.service';
import { EventLedgerRepository } from './event-ledger.repository';

/**
 * Simulates concurrent writes by running two appendEvent calls in parallel.
 * The mock transaction serializes them (as a real DB transaction would),
 * but the sequence numbers must still be unique and sequential.
 */
describe('EventLedgerService', () => {
  const createdEvents: Array<Record<string, unknown>> = [];

  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    eventLog: {
      findFirst: jest.fn(async () => {
        const aggregateEvents = createdEvents.filter(
          (e) => e.entityId === 'pet-1',
        );
        const latest = aggregateEvents.reduce<number | null>(
          (max, e) =>
            typeof e.sequenceNumber === 'number' &&
            (max === null || e.sequenceNumber > max)
              ? e.sequenceNumber
              : max,
          null,
        );
        return latest === null ? null : { sequenceNumber: latest };
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `evt-${createdEvents.length + 1}`, ...data };
        createdEvents.push(event);
        return event;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
    ),
  };

  const repository = {
    findAllByAggregate: jest.fn().mockResolvedValue([]),
    findGaps: jest.fn().mockResolvedValue([]),
    findAllByAggregateType: jest.fn().mockResolvedValue([]),
    findAllByEventType: jest.fn().mockResolvedValue([]),
  };

  let service: EventLedgerService;

  beforeEach(() => {
    createdEvents.length = 0;
    jest.clearAllMocks();
    service = new EventLedgerService(
      prisma as never,
      repository as unknown as EventLedgerRepository,
    );
  });

  it('assigns sequence 1 to the first event', async () => {
    const result = await service.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId: 'pet-1',
      eventType: 'PET_REGISTERED',
      payload: { name: 'Buddy' },
    });

    expect(result.sequenceNumber).toBe(1);
  });

  it('assigns sequential numbers across multiple appends', async () => {
    for (let i = 0; i < 5; i++) {
      await service.appendEvent({
        aggregateType: EventEntityType.PET,
        aggregateId: 'pet-1',
        eventType: 'PET_REGISTERED',
        payload: { index: i },
      });
    }

    expect(createdEvents.map((e) => e.sequenceNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('uses a DB transaction for each append', async () => {
    await service.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId: 'pet-1',
      eventType: 'PET_REGISTERED',
      payload: {},
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalled();
  });

  it('creates the event with correct fields', async () => {
    const result = await service.appendEvent({
      aggregateType: EventEntityType.ADOPTION,
      aggregateId: 'adoption-1',
      eventType: 'ADOPTION_REQUESTED',
      actorId: 'user-1',
      payload: { petId: 'pet-1', adopterId: 'user-1' },
    });

    expect(transaction.eventLog.create).toHaveBeenCalledWith({
      data: {
        entityType: EventEntityType.ADOPTION,
        entityId: 'adoption-1',
        eventType: 'ADOPTION_REQUESTED',
        actorId: 'user-1',
        payload: { petId: 'pet-1', adopterId: 'user-1' },
        sequenceNumber: 1,
      },
    });
  });

  it('detects gaps in sequence numbers', async () => {
    repository.findGaps.mockResolvedValue([2, 4]);

    const gaps = await service.detectGaps('pet-1');

    expect(gaps).toEqual([2, 4]);
    expect(repository.findGaps).toHaveBeenCalledWith('pet-1');
  });

  it('returns aggregate events from the repository', async () => {
    const mockEvents = [{ id: '1', sequenceNumber: 1 }];
    repository.findAllByAggregate.mockResolvedValue(mockEvents);

    const result = await service.getAggregateEvents('pet-1');

    expect(result).toEqual(mockEvents);
    expect(repository.findAllByAggregate).toHaveBeenCalledWith('pet-1');
  });

  it('queues anchoring job after successful append (best-effort)', async () => {
    const loggerSpy = jest.spyOn(service['logger'], 'log');

    await service.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId: 'pet-1',
      eventType: 'PET_REGISTERED',
      payload: {},
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Queuing anchoring job'),
    );
  });

  it('does not fail if anchoring job queue throws', async () => {
    const loggerSpy = jest.spyOn(service['logger'], 'warn');

    // Override queueAnchoringJob to throw
    const original = service['queueAnchoringJob'];
    service['queueAnchoringJob'] = jest
      .fn()
      .mockRejectedValue(new Error('Queue unavailable'));

    const result = await service.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId: 'pet-1',
      eventType: 'PET_REGISTERED',
      payload: {},
    });

    expect(result).toBeDefined();
    expect(result.sequenceNumber).toBe(1);
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to queue anchoring job'),
    );

    service['queueAnchoringJob'] = original;
  });

  /**
   * CONCURRENCY TEST (Issue #126 acceptance criterion):
   * Two concurrent appends for the same aggregate produce correct,
   * unique sequence numbers with no duplicates.
   *
   * In production, PostgreSQL advisory locks serialize concurrent
   * transactions for the same aggregate. We simulate this by using
   * a $transaction mock that queues callbacks and runs them
   * sequentially (awaiting each before starting the next).
   */
  it('concurrent appends for same aggregate produce correct, unique sequence numbers', async () => {
    const events: Array<Record<string, unknown>> = [];
    let callCount = 0;

    // Simulate advisory lock: queue callbacks and run them serially
    let txQueue: Array<() => Promise<unknown>> = [];
    let processing = false;

    const processQueue = async (): Promise<void> => {
      if (processing) return;
      processing = true;
      while (txQueue.length > 0) {
        const next = txQueue.shift()!;
        await next();
      }
      processing = false;
    };

    const serializedPrisma = {
      $transaction: jest.fn(async (cb: Function) => {
        return new Promise((resolve) => {
          txQueue.push(async () => {
            const tx = {
              $executeRaw: jest.fn().mockResolvedValue(0),
              eventLog: {
                findFirst: jest.fn(async () => {
                  const agg = events.filter((e) => e.entityId === 'pet-1');
                  const latest = agg.reduce<number | null>(
                    (max, e) =>
                      typeof e.sequenceNumber === 'number' &&
                      (max === null || e.sequenceNumber > max)
                        ? e.sequenceNumber
                        : max,
                    null,
                  );
                  return latest === null ? null : { sequenceNumber: latest };
                }),
                create: jest.fn(
                  async ({ data }: { data: Record<string, unknown> }) => {
                    const event = {
                      id: `evt-${++callCount}`,
                      ...data,
                    };
                    events.push(event);
                    return event;
                  },
                ),
              },
            };
            const result = await cb(tx);
            resolve(result);
          });
          processQueue();
        });
      }),
    };

    const concurrentService = new EventLedgerService(
      serializedPrisma as never,
      repository as unknown as EventLedgerRepository,
    );

    // Fire two appends concurrently — $transaction queue serializes them
    const [event1, event2] = await Promise.all([
      concurrentService.appendEvent({
        aggregateType: EventEntityType.PET,
        aggregateId: 'pet-1',
        eventType: 'PET_REGISTERED',
        payload: { name: 'Buddy' },
      }),
      concurrentService.appendEvent({
        aggregateType: EventEntityType.PET,
        aggregateId: 'pet-1',
        eventType: 'PET_ADOPTED',
        payload: { adopterId: 'user-1' },
      }),
    ]);

    // Both events should have unique sequence numbers
    const sequences = [event1.sequenceNumber, event2.sequenceNumber].sort(
      (a, b) => a - b,
    );
    expect(sequences).toEqual([1, 2]);

    // No duplicate sequence numbers
    expect(new Set(sequences).size).toBe(2);

    // The events array should have exactly 2 events
    expect(events).toHaveLength(2);

    // Both events exist with correct aggregate
    expect(events.every((e) => e.entityId === 'pet-1')).toBe(true);
  });

  it('concurrent appends for different aggregates produce independent sequence numbers', async () => {
    const [event1, event2] = await Promise.all([
      service.appendEvent({
        aggregateType: EventEntityType.PET,
        aggregateId: 'pet-1',
        eventType: 'PET_REGISTERED',
        payload: {},
      }),
      service.appendEvent({
        aggregateType: EventEntityType.ADOPTION,
        aggregateId: 'adoption-1',
        eventType: 'ADOPTION_REQUESTED',
        payload: {},
      }),
    ]);

    // Each aggregate starts at sequence 1 independently
    expect(event1.sequenceNumber).toBe(1);
    expect(event2.sequenceNumber).toBe(1);
  });

  it('five sequential appends produce sequences 1 through 5', async () => {
    for (let i = 0; i < 5; i++) {
      await service.appendEvent({
        aggregateType: EventEntityType.PET,
        aggregateId: 'pet-1',
        eventType: 'PET_REGISTERED',
        payload: {},
      });
    }

    expect(createdEvents.map((e) => e.sequenceNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});
