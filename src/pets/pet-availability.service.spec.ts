import { Test, TestingModule } from '@nestjs/testing';
import { PetAvailabilityService, ComputedPetStatus } from './pet-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { AdoptionStatus, CustodyStatus, EventEntityType, EventType } from '@prisma/client';

describe('PetAvailabilityService', () => {
  let service: PetAvailabilityService;
  let prismaService: jest.Mocked<PrismaService>;
  let eventsService: jest.Mocked<EventsService>;

  const mockPrismaService = {
    adoption: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    custody: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    pet: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetAvailabilityService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
      ],
    }).compile();

    service = module.get<PetAvailabilityService>(PetAvailabilityService);
    prismaService = module.get(PrismaService);
    eventsService = module.get(EventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolve', () => {
    const petId = 'pet-123';

    it('should return ADOPTED when adoption status is COMPLETED', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.COMPLETED,
        createdAt: new Date(),
      });

      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.ADOPTED);
      expect(mockPrismaService.adoption.findFirst).toHaveBeenCalledWith({
        where: { petId },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return IN_CUSTODY when custody status is ACTIVE', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
        petId,
      });

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.IN_CUSTODY);
      expect(mockPrismaService.custody.findFirst).toHaveBeenCalledWith({
        where: { petId, status: CustodyStatus.ACTIVE },
      });
    });

    it('should return PENDING when adoption status is REQUESTED', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REQUESTED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.PENDING);
    });

    it('should return PENDING when adoption status is PENDING', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.PENDING,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.PENDING);
    });

    it('should return PENDING when adoption status is APPROVED', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.APPROVED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.PENDING);
    });

    it('should return PENDING when adoption status is ESCROW_FUNDED', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.ESCROW_FUNDED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.PENDING);
    });

    it('should return AVAILABLE when no active adoption or custody', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.AVAILABLE);
    });

    it('should prioritize ADOPTED over IN_CUSTODY', async () => {
      // Arrange - both completed adoption and active custody exist
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.COMPLETED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
        petId,
      });

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.ADOPTED);
    });

    it('should prioritize IN_CUSTODY over PENDING', async () => {
      // Arrange - both active custody and pending adoption exist
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REQUESTED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
        petId,
      });

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.IN_CUSTODY);
    });

    it('should ignore REJECTED adoption status', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REJECTED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.AVAILABLE);
    });

    it('should ignore CANCELLED adoption status', async () => {
      // Arrange
      mockPrismaService.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.CANCELLED,
        createdAt: new Date(),
      });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resolve(petId);

      // Assert
      expect(result).toBe(ComputedPetStatus.AVAILABLE);
    });
  });

  describe('resolveBatch', () => {
    it('should resolve availability for multiple pets', async () => {
      // Arrange
      const petIds = ['pet-1', 'pet-2', 'pet-3'];
      
      mockPrismaService.adoption.findMany.mockResolvedValueOnce([
        { id: 'adoption-1', petId: 'pet-1', status: AdoptionStatus.COMPLETED, createdAt: new Date() },
        { id: 'adoption-2', petId: 'pet-2', status: AdoptionStatus.REQUESTED, createdAt: new Date() },
      ]);

      mockPrismaService.custody.findMany.mockResolvedValueOnce([
        { id: 'custody-1', petId: 'pet-3', status: CustodyStatus.ACTIVE },
      ]);

      // Act
      const result = await service.resolveBatch(petIds);

      // Assert
      expect(result.size).toBe(3);
      expect(result.get('pet-1')).toBe(ComputedPetStatus.ADOPTED);
      expect(result.get('pet-2')).toBe(ComputedPetStatus.PENDING);
      expect(result.get('pet-3')).toBe(ComputedPetStatus.IN_CUSTODY);
    });

    it('should return AVAILABLE for pets with no records', async () => {
      // Arrange
      const petIds = ['pet-1', 'pet-2'];
      
      mockPrismaService.adoption.findMany.mockResolvedValueOnce([]);
      mockPrismaService.custody.findMany.mockResolvedValueOnce([]);

      // Act
      const result = await service.resolveBatch(petIds);

      // Assert
      expect(result.size).toBe(2);
      expect(result.get('pet-1')).toBe(ComputedPetStatus.AVAILABLE);
      expect(result.get('pet-2')).toBe(ComputedPetStatus.AVAILABLE);
    });
  });

  describe('getPetWithAvailability', () => {
    it('should return pet with computed availability', async () => {
      // Arrange
      const petId = 'pet-1';
      const mockPet = {
        id: petId,
        name: 'Buddy',
        species: 'DOG',
        currentOwner: null,
      };

      mockPrismaService.pet.findUnique.mockResolvedValueOnce(mockPet);
      
      // Mock the resolve method
      jest.spyOn(service, 'resolve').mockResolvedValueOnce(ComputedPetStatus.AVAILABLE);

      // Act
      const result = await service.getPetWithAvailability(petId);

      // Assert
      expect(result).toEqual({
        ...mockPet,
        status: ComputedPetStatus.AVAILABLE,
      });
      expect(mockPrismaService.pet.findUnique).toHaveBeenCalledWith({
        where: { id: petId },
        include: { currentOwner: true },
      });
    });

    it('should throw error when pet not found', async () => {
      // Arrange
      const petId = 'nonexistent-pet';
      mockPrismaService.pet.findUnique.mockResolvedValueOnce(null);

      // Act & Assert
      await expect(service.getPetWithAvailability(petId)).rejects.toThrow(
        `Pet with ID ${petId} not found`
      );
    });
  });

  describe('getPetsWithAvailability', () => {
    it('should return pets with computed availability', async () => {
      // Arrange
      const mockPets = [
        { id: 'pet-1', name: 'Buddy', currentOwner: null },
        { id: 'pet-2', name: 'Max', currentOwner: null },
      ];

      mockPrismaService.pet.findMany.mockResolvedValueOnce(mockPets);
      
      // Mock resolveBatch
      jest.spyOn(service, 'resolveBatch').mockResolvedValueOnce(
        new Map([
          ['pet-1', ComputedPetStatus.AVAILABLE],
          ['pet-2', ComputedPetStatus.ADOPTED],
        ])
      );

      // Act
      const result = await service.getPetsWithAvailability();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe(ComputedPetStatus.AVAILABLE);
      expect(result[1].status).toBe(ComputedPetStatus.ADOPTED);
    });
  });

  describe('logAvailabilityChange', () => {
    it('should log event when status changes', async () => {
      // Arrange
      const petId = 'pet-1';
      const oldStatus = ComputedPetStatus.AVAILABLE;
      const newStatus = ComputedPetStatus.ADOPTED;
      const triggerEvent = 'adoption_completed';
      const actorId = 'user-1';

      // Act
      await service.logAvailabilityChange(petId, oldStatus, newStatus, triggerEvent, actorId);

      // Assert
      expect(eventsService.logEvent).toHaveBeenCalledWith({
        entityType: EventEntityType.PET,
        entityId: petId,
        eventType: EventType.PET_STATUS_CHANGED,
        actorId,
        payload: {
          oldStatus,
          newStatus,
          triggerEvent,
          timestamp: expect.any(String),
        },
      });
    });

    it('should not log event when status does not change', async () => {
      // Arrange
      const petId = 'pet-1';
      const oldStatus = ComputedPetStatus.AVAILABLE;
      const newStatus = ComputedPetStatus.AVAILABLE;
      const triggerEvent = 'no_change';

      // Act
      await service.logAvailabilityChange(petId, oldStatus, newStatus, triggerEvent);

      // Assert
      expect(eventsService.logEvent).not.toHaveBeenCalled();
    });
  });
});
