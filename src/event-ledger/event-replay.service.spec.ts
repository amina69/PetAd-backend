import { Test, TestingModule } from '@nestjs/testing';
import { EventReplayService } from './event-replay.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType } from '@prisma/client';

describe('EventReplayService', () => {
  let service: EventReplayService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    eventLog: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReplayService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<EventReplayService>(EventReplayService);
    prismaService = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('replayAggregate', () => {
    const aggregateId = 'pet-123';
    const entityType: EventEntityType = 'PET';

    const mockEvents = [
      {
        id: 'event-1',
        entityType: 'PET',
        entityId: aggregateId,
        eventType: 'PET_REGISTERED',
        actorId: null,
        txHash: null,
        blockHeight: null,
        payload: { name: 'Buddy', species: 'DOG' },
        metadata: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        id: 'event-2',
        entityType: 'PET',
        entityId: aggregateId,
        eventType: 'PET_LISTED',
        actorId: null,
        txHash: 'stellar-tx-1',
        blockHeight: 100,
        payload: { listed: true, price: 500 },
        metadata: null,
        createdAt: new Date('2024-01-02T00:00:00Z'),
      },
      {
        id: 'event-3',
        entityType: 'PET',
        entityId: aggregateId,
        eventType: 'PET_ADOPTED',
        actorId: 'user-1',
        txHash: null,
        blockHeight: null,
        payload: { adoptedBy: 'user-1' },
        metadata: null,
        createdAt: new Date('2024-01-03T00:00:00Z'),
      },
    ];

    it('should replay all events and return final state', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.replayAggregate(aggregateId, entityType);

      expect(result.aggregateId).toBe(aggregateId);
      expect(result.entityType).toBe(entityType);
      expect(result.eventsProcessed).toBe(3);
      expect(result.totalEvents).toBe(3);
      expect(result.dryRun).toBe(false);
      expect(result.replayedUpToSequence).toBeNull();
      expect(result.finalState).toHaveProperty('name', 'Buddy');
      expect(result.finalState).toHaveProperty('species', 'DOG');
      expect(result.finalState).toHaveProperty('adoptedBy', 'user-1');
      expect(result.finalState).toHaveProperty('lastEventType', 'PET_ADOPTED');
    });

    it('should handle dryRun option correctly', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.replayAggregate(aggregateId, entityType, {
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.eventsProcessed).toBe(3);
      // Dry run still computes the state, just doesn't write to DB
      expect(result.finalState).toBeDefined();
    });

    it('should limit replay up to a specific sequence number', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      // Replay only up to event #1 (first event)
      const result = await service.replayAggregate(aggregateId, entityType, {
        upToSequence: 1,
      });

      expect(result.eventsProcessed).toBe(1);
      expect(result.totalEvents).toBe(3);
      expect(result.replayedUpToSequence).toBe(1);
      expect(result.finalState).toHaveProperty('name', 'Buddy');
      expect(result.finalState).toHaveProperty('species', 'DOG');
      // Should NOT have PET_ADOPTED payload since it's event #3
      expect(result.finalState).not.toHaveProperty('adoptedBy');
      expect(result.finalState).toHaveProperty('lastEventType', 'PET_REGISTERED');
    });

    it('should replay up to sequence 2', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.replayAggregate(aggregateId, entityType, {
        upToSequence: 2,
      });

      expect(result.eventsProcessed).toBe(2);
      expect(result.replayedUpToSequence).toBe(2);
      expect(result.finalState).toHaveProperty('name', 'Buddy');
      expect(result.finalState).toHaveProperty('listed', true);
      expect(result.finalState).toHaveProperty('lastEventType', 'PET_LISTED');
      // Should NOT have PET_ADOPTED payload
      expect(result.finalState).not.toHaveProperty('adoptedBy');
    });

    it('should handle upToSequence beyond total events by using all events', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.replayAggregate(aggregateId, entityType, {
        upToSequence: 999,
      });

      expect(result.eventsProcessed).toBe(3);
      expect(result.totalEvents).toBe(3);
    });

    it('should handle empty event log gracefully', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      const result = await service.replayAggregate(aggregateId, entityType);

      expect(result.eventsProcessed).toBe(0);
      expect(result.totalEvents).toBe(0);
      expect(result.finalState).toEqual({});
    });

    it('should handle event with null payload', async () => {
      const eventsWithNullPayload = [
        {
          id: 'event-1',
          entityType: 'PET',
          entityId: aggregateId,
          eventType: 'PET_REGISTERED',
          actorId: null,
          txHash: null,
          blockHeight: null,
          payload: null,
          metadata: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockPrismaService.eventLog.findMany.mockResolvedValue(eventsWithNullPayload);

      const result = await service.replayAggregate(aggregateId, entityType);

      expect(result.eventsProcessed).toBe(1);
      expect(result.finalState).toHaveProperty('lastEventType', 'PET_REGISTERED');
    });

    it('should handle event with array payload (non-object)', async () => {
      const eventsWithArrayPayload = [
        {
          id: 'event-1',
          entityType: 'PET',
          entityId: aggregateId,
          eventType: 'PET_REGISTERED',
          actorId: null,
          txHash: null,
          blockHeight: null,
          payload: ['item1', 'item2'],
          metadata: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockPrismaService.eventLog.findMany.mockResolvedValue(eventsWithArrayPayload);

      const result = await service.replayAggregate(aggregateId, entityType);

      expect(result.eventsProcessed).toBe(1);
      // Array payload should be ignored, only lastEventType added
      expect(result.finalState).toHaveProperty('lastEventType', 'PET_REGISTERED');
      expect(Object.keys(result.finalState)).toHaveLength(1);
    });

    it('should query events filtered by entityType and aggregateId', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      await service.replayAggregate(aggregateId, entityType);

      expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith({
        where: {
          entityType,
          entityId: aggregateId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });
    });

    it('should combine dryRun with upToSequence', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.replayAggregate(aggregateId, entityType, {
        dryRun: true,
        upToSequence: 2,
      });

      expect(result.dryRun).toBe(true);
      expect(result.replayedUpToSequence).toBe(2);
      expect(result.eventsProcessed).toBe(2);
    });
  });
});
