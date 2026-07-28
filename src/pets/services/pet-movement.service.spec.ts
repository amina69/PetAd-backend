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
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);

      const result = await service.getMovementHistory(petId);

      expect(result).toEqual({
        petId,
        petName: 'Buddy',
        timeline: [],
      });
    });

    it('should return events in chronological order', async () => {
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
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].eventType).toBe('CUSTODY_STARTED');
      expect(result.timeline[1].eventType).toBe('CUSTODY_CANCELLED');
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
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline[0].stellarTxHash).toBeUndefined();
      expect(result.timeline[0].anchorStatus).toBe('PENDING');
    });

    it('should query for both PET-scoped events and payload with petId', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
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
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId);

      expect(result.timeline[0].summary).toContain('Custody cancelled');
      expect(result.timeline[0].summary).toContain('Adopter changed mind');
    });
  });
});
