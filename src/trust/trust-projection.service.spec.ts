import { Test, TestingModule } from '@nestjs/testing';
import {
  EventEntityType,
  EventType,
  Prisma,
  TrustEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrustProjectionService } from './trust-projection.service';
import { TrustEventMapperService } from './trust-event-mapper.service';
import { TrustScoreService } from './trust-score.service';

describe('TrustProjectionService', () => {
  type TransactionClient = {
    trustEventSource: { create: jest.Mock };
    trustEvent: { createMany: jest.Mock };
  };

  let service: TrustProjectionService;
  let prisma: {
    eventLog: { findUnique: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mapper: { map: jest.Mock };
  let scores: { recomputeUser: jest.Mock };
  let tx: TransactionClient;

  const sourceEvent = {
    id: 'event-1',
    entityType: EventEntityType.REVIEW,
    entityId: 'review-1',
    eventType: EventType.REVIEW_CREATED,
    actorId: 'reviewer-1',
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    payload: { subjectId: 'subject-1', rating: 5 },
  };

  beforeEach(async () => {
    tx = {
      trustEventSource: { create: jest.fn().mockResolvedValue({}) },
      trustEvent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      eventLog: {
        findUnique: jest.fn().mockResolvedValue(sourceEvent),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: TransactionClient) => Promise<unknown>) =>
            callback(tx),
        ),
    };
    mapper = {
      map: jest.fn().mockResolvedValue([
        {
          subjectUserId: 'subject-1',
          type: TrustEventType.POSITIVE_REVIEW,
          weight: 1,
          occurredAt: sourceEvent.createdAt,
          payload: { sourceEventId: sourceEvent.id },
        },
      ]),
    };
    scores = { recomputeUser: jest.fn().mockResolvedValue({ score: 55 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustProjectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TrustEventMapperService, useValue: mapper },
        { provide: TrustScoreService, useValue: scores },
      ],
    }).compile();

    service = module.get(TrustProjectionService);
  });

  it('records a source event once and recomputes each affected subject', async () => {
    await expect(service.processSourceEvent('event-1')).resolves.toBe(true);

    expect(tx.trustEventSource.create).toHaveBeenCalledWith({
      data: { sourceEventId: 'event-1' },
    });
    expect(tx.trustEvent.createMany).toHaveBeenCalledTimes(1);
    expect(scores.recomputeUser).toHaveBeenCalledWith('subject-1');
  });

  it('ignores duplicate delivery of the same source event id', async () => {
    await service.processSourceEvent('event-1');
    tx.trustEventSource.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.processSourceEvent('event-1')).resolves.toBe(false);
    expect(tx.trustEvent.createMany).toHaveBeenCalledTimes(1);
    expect(scores.recomputeUser).toHaveBeenCalledTimes(1);
  });

  it('replays an event only once when scanning unprojected events', async () => {
    prisma.eventLog.findMany.mockResolvedValueOnce([{ id: 'event-1' }]);
    const selectMatcher: object = expect.any(Object) as object;

    await expect(service.processAll()).resolves.toBe(1);
    expect(prisma.eventLog.findUnique).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      select: selectMatcher,
    });
  });
});
