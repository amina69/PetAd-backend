import { EventEntityType } from '@prisma/client';
import { EventLedgerService } from './event-ledger.service';
import { EventLedgerRepository } from './event-ledger.repository';

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
});
