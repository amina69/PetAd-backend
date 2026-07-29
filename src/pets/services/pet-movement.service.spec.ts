import { Test, TestingModule } from '@nestjs/testing';
import { PetMovementService } from './pet-movement.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('PetMovementService', () => {
  let service: PetMovementService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    pet: {
      findUnique: jest.fn(),
    },
    eventLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetMovementService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PetMovementService>(PetMovementService);
    prismaService = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMovementHistory', () => {
    const petId = 'pet-123';
    const mockPet = { id: petId, name: 'Buddy' };

    it('should throw NotFoundException when pet does not exist', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(null);

      await expect(service.getMovementHistory(petId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getMovementHistory(petId)).rejects.toThrow(
        `Pet with ID ${petId} not found`,
      );
    });

    it('should return pet history with empty timeline when no events exist', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(0);
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      const result = await service.getMovementHistory(petId);

      expect(result).toEqual({
        petId,
        petName: 'Buddy',
        timeline: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    });

    it('should return events in chronological order (ascending)', async () => {
      const earlierDate = new Date('2024-01-01T00:00:00Z');
      const laterDate = new Date('2024-01-02T00:00:00Z');

      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_STARTED',
          payload: { petId },
          createdAt: earlierDate,
          txHash: null,
        },
        {
          id: 'event-2',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_CANCELLED',
          payload: { petId, reason: 'No longer needed' },
          createdAt: laterDate,
          txHash: 'stellar-tx-hash-123',
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(2);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].eventType).toBe('CUSTODY_STARTED');
      expect(result.timeline[1].eventType).toBe('CUSTODY_CANCELLED');
      expect(result.total).toBe(2);
    });

    it('should support descending sort order', async () => {
      const earlierDate = new Date('2024-01-01T00:00:00Z');
      const laterDate = new Date('2024-01-02T00:00:00Z');

      // Returned in descending order
      const mockEvents = [
        {
          id: 'event-2',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_CANCELLED',
          payload: { petId },
          createdAt: laterDate,
          txHash: null,
        },
        {
          id: 'event-1',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_STARTED',
          payload: { petId },
          createdAt: earlierDate,
          txHash: null,
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(2);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId, { sort: 'desc' });

      expect(result.timeline[0].eventType).toBe('CUSTODY_CANCELLED');
      expect(result.timeline[1].eventType).toBe('CUSTODY_STARTED');

      // Verify the sort order was passed correctly
      expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should include stellarTxHash and ANCHORED status for anchored events', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_STARTED',
          payload: { petId },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: 'stellar-tx-hash-456',
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(1);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline[0].stellarTxHash).toBe('stellar-tx-hash-456');
      expect(result.timeline[0].anchorStatus).toBe('ANCHORED');
    });

    it('should show PENDING anchorStatus when no txHash exists', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_STARTED',
          payload: { petId },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: null,
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(1);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline[0].stellarTxHash).toBeUndefined();
      expect(result.timeline[0].anchorStatus).toBe('PENDING');
    });

    it('should query for both PET-scoped events and payload with petId', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(0);
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      await service.getMovementHistory(petId);

      expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { entityType: 'PET', entityId: petId },
              {
                payload: {
                  path: ['petId'],
                  string_contains: petId,
                },
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('should include summary with reason in event timeline', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_CANCELLED',
          payload: { petId, reason: 'Adopter changed mind' },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: null,
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(1);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline[0].summary).toContain('Custody cancelled');
      expect(result.timeline[0].summary).toContain('Adopter changed mind');
    });

    it('should apply default pagination (page=1, limit=20) when no options provided', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(0);
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      const result = await service.getMovementHistory(petId);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(0);
    });

    it('should calculate skip correctly for second page', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(25);
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      await service.getMovementHistory(petId, { page: 2, limit: 10 });

      expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should return page 1 with 20 items and page 2 with 5 items for 25 events', async () => {
      const createEvent = (index: number) => ({
        id: `event-${index}`,
        entityType: 'CUSTODY',
        entityId: 'custody-1',
        eventType: 'CUSTODY_STARTED',
        payload: { petId },
        createdAt: new Date(`2024-01-${String(index).padStart(2, '0')}T00:00:00Z`),
        txHash: null,
      });

      const all25Events = Array.from({ length: 25 }, (_, i) => createEvent(i + 1));
      const first20Events = all25Events.slice(0, 20);
      const last5Events = all25Events.slice(20);

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);

      // Page 1
      mockPrismaService.eventLog.count.mockResolvedValue(25);
      mockPrismaService.eventLog.findMany.mockResolvedValue(first20Events);

      const page1Result = await service.getMovementHistory(petId, {
        page: 1,
        limit: 20,
      });

      expect(page1Result.timeline).toHaveLength(20);
      expect(page1Result.total).toBe(25);
      expect(page1Result.page).toBe(1);
      expect(page1Result.limit).toBe(20);

      // Verify skip/take for page 1
      expect(mockPrismaService.eventLog.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );

      // Page 2
      mockPrismaService.eventLog.findMany.mockResolvedValue(last5Events);

      const page2Result = await service.getMovementHistory(petId, {
        page: 2,
        limit: 20,
      });

      expect(page2Result.timeline).toHaveLength(5);
      expect(page2Result.total).toBe(25);
      expect(page2Result.page).toBe(2);
      expect(page2Result.limit).toBe(20);

      // Verify skip/take for page 2
      expect(mockPrismaService.eventLog.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );
    });

    it('should include total count in response', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.count.mockResolvedValue(42);
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      const result = await service.getMovementHistory(petId);

      expect(result.total).toBe(42);
    });
  });
});
