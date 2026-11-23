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
    const mockPet = { id: petId, name: 'Buddy', currentOwnerId: 'owner-1' };

    it('should throw NotFoundException when pet does not exist', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(null);

      await expect(service.getMovementHistory(petId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return full history with custody hops and eventId for authorized users', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'PET',
          entityId: petId,
          eventType: 'PET_REGISTERED',
          payload: { petId, anchorBatch: 'batch-001' },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: 'tx-1',
          actorId: 'owner-1',
        },
        {
          id: 'event-2',
          entityType: 'CUSTODY',
          entityId: 'custody-1',
          eventType: 'CUSTODY_STARTED',
          payload: { petId, holderId: 'holder-1' },
          createdAt: new Date('2024-01-02T00:00:00Z'),
          txHash: null,
          actorId: 'holder-1',
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result: any = await service.getMovementHistory(petId, 'json', {
        userId: 'owner-1',
        role: 'USER',
      });

      expect(result.petId).toBe(petId);
      expect(result.custodyChain).toHaveLength(2);
      expect(result.custodyChain[0].eventId).toBe('event-1');
      expect(result.custodyChain[0].anchorBatch).toBe('batch-001');
      expect(result.custodyChain[1].toUserId).toBe('holder-1');
    });

    it('should detect overlapping custody periods as anomalies', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'CUSTODY',
          entityId: 'c1',
          eventType: 'CUSTODY_STARTED',
          payload: { petId, holderId: 'holder-1' },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: null,
        },
        {
          id: 'event-2',
          entityType: 'CUSTODY',
          entityId: 'c2',
          eventType: 'CUSTODY_STARTED',
          payload: { petId, holderId: 'holder-2' },
          createdAt: new Date('2024-01-05T00:00:00Z'),
          txHash: null,
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result: any = await service.getMovementHistory(petId, 'json', {
        userId: 'owner-1',
        role: 'ADMIN',
      });

      expect(result.anomalyCount).toBeGreaterThan(0);
      expect(result.anomalies[0].type).toBe('OVERLAP');
      expect(result.verifiedChain).toBe(false);
    });

    it('should limit public view to counts and verified-chain badge', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'PET',
          entityId: petId,
          eventType: 'PET_REGISTERED',
          payload: { petId },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: null,
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result: any = await service.getMovementHistory(petId, 'json', {
        userId: 'stranger',
        role: 'USER',
      });

      expect(result).toHaveProperty('hopCount');
      expect(result).toHaveProperty('verifiedChain');
      expect(result).not.toHaveProperty('custodyChain');
    });

    it('should support CSV format output', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          entityType: 'PET',
          entityId: petId,
          eventType: 'PET_REGISTERED',
          payload: { petId },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          txHash: null,
        },
      ];

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.eventLog.findMany.mockResolvedValue(mockEvents);

      const result = await service.getMovementHistory(petId, 'csv', {
        userId: 'owner-1',
        role: 'ADMIN',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('hopIndex,toRole,toUserId');
    });
  });
});
