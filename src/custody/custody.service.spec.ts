import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
import { CreateCustodyDto } from './dto/create-custody.dto';

describe('CustodyService', () => {
  let service: CustodyService;
  let prismaService: PrismaService;
  let eventsService: EventsService;
  let escrowService: EscrowService;

  const mockPrismaService = {
    pet: {
      findUnique: jest.fn(),
    },
    custody: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    adoption: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  const mockEscrowService = {
    createEscrow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustodyService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: EscrowService,
          useValue: mockEscrowService,
        },
      ],
    }).compile();

    service = module.get<CustodyService>(CustodyService);
    prismaService = module.get<PrismaService>(PrismaService);
    eventsService = module.get<EventsService>(EventsService);
    escrowService = module.get<EscrowService>(EscrowService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have PrismaService injected', () => {
    expect(prismaService).toBeDefined();
  });

  it('should have EventsService injected', () => {
    expect(eventsService).toBeDefined();
  });

  it('should have EscrowService injected', () => {
    expect(escrowService).toBeDefined();
  });

  describe('createCustody', () => {
    const userId = 'user-123';
    const createCustodyDto: CreateCustodyDto = {
      petId: 'pet-123',
      startDate: '2024-12-25T00:00:00.000Z',
      durationDays: 14,
      depositAmount: 100,
    };

    it('should throw NotFoundException when pet does not exist', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(null);

      await expect(
        service.createCustody(userId, createCustodyDto),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.createCustody(userId, createCustodyDto),
      ).rejects.toThrow('Pet with id pet-123 not found');

      expect(mockPrismaService.pet.findUnique).toHaveBeenCalledWith({
        where: { id: 'pet-123' },
      });
    });

    it('should call pet.findUnique with correct petId', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      try {
        await service.createCustody(userId, createCustodyDto);
      } catch (error) {
        // Expected to throw BadRequestException for now
      }

      expect(mockPrismaService.pet.findUnique).toHaveBeenCalledWith({
        where: { id: 'pet-123' },
      });
    });

    it('should throw BadRequestException when pet is already adopted', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst.mockResolvedValueOnce({
        id: 'adoption-123',
        status: 'COMPLETED',
        petId: 'pet-123',
      });

      await expect(
        service.createCustody(userId, createCustodyDto),
      ).rejects.toThrow('Pet is already adopted');

      expect(mockPrismaService.adoption.findFirst).toHaveBeenCalledWith({
        where: {
          petId: 'pet-123',
          status: 'COMPLETED',
        },
      });
    });

    it('should throw BadRequestException when pet has active adoption in progress', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null) // No completed adoption
        .mockResolvedValueOnce({
          // Active adoption
          id: 'adoption-123',
          status: 'PENDING',
          petId: 'pet-123',
        });

      await expect(
        service.createCustody(userId, createCustodyDto),
      ).rejects.toThrow('Pet has an active adoption in progress');

      expect(mockPrismaService.adoption.findFirst).toHaveBeenCalledWith({
        where: {
          petId: 'pet-123',
          status: {
            in: ['REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED'],
          },
        },
      });
    });

    it('should throw BadRequestException when pet has active custody', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue({
        id: 'custody-123',
        status: 'ACTIVE',
        petId: 'pet-123',
      });

      await expect(
        service.createCustody(userId, createCustodyDto),
      ).rejects.toThrow('Pet already has an active custody agreement');

      expect(mockPrismaService.custody.findFirst).toHaveBeenCalledWith({
        where: {
          petId: 'pet-123',
          status: 'ACTIVE',
        },
      });
    });

    it('should throw BadRequestException when startDate is in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const dto: CreateCustodyDto = {
        ...createCustodyDto,
        startDate: pastDate.toISOString(),
      };

      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      await expect(service.createCustody(userId, dto)).rejects.toThrow(
        'Start date cannot be in the past',
      );
    });

    it('should throw BadRequestException when durationDays is less than 1', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        ...createCustodyDto,
        startDate: futureDate.toISOString(),
        durationDays: 0,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      await expect(service.createCustody(userId, dto)).rejects.toThrow(
        'Duration must be between 1 and 90 days',
      );
    });

    it('should throw BadRequestException when durationDays is greater than 90', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        ...createCustodyDto,
        startDate: futureDate.toISOString(),
        durationDays: 91,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue({
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      await expect(service.createCustody(userId, dto)).rejects.toThrow(
        'Duration must be between 1 and 90 days',
      );
    });

    it('should accept durationDays of 1 (boundary case)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 1,
      };

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      };

      const mockCustody = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: new Date(),
        depositAmount: null,
        escrowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      const result = await service.createCustody(userId, dto);
      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(mockEscrowService.createEscrow).not.toHaveBeenCalled();
    });

    it('should accept durationDays of 90 (boundary case)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 90,
      };

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      };

      const mockCustody = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: new Date(),
        depositAmount: null,
        escrowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      const result = await service.createCustody(userId, dto);
      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(mockEscrowService.createEscrow).not.toHaveBeenCalled();
    });

    it('should accept startDate equal to today', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: today.toISOString(),
        durationDays: 14,
      };

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      };

      const mockCustody = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: new Date(),
        depositAmount: null,
        escrowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      const result = await service.createCustody(userId, dto);
      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(mockEscrowService.createEscrow).not.toHaveBeenCalled();
    });

    it('should create custody record with correct data', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 14,
        depositAmount: 100,
      };

      const expectedEndDate = new Date(futureDate);
      expectedEndDate.setDate(expectedEndDate.getDate() + 14);

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
        breed: 'Golden Retriever',
        age: 3,
        description: 'Friendly dog',
        imageUrl: 'https://example.com/buddy.jpg',
      };

      const mockEscrow = {
        id: 'escrow-123',
        stellarPublicKey: 'ESCROW_PUBLIC_KEY',
        stellarSecretEncrypted: 'ENCRYPTED_SECRET',
        amount: 100,
        status: 'CREATED',
      };

      const mockCustody = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: expectedEndDate,
        depositAmount: 100,
        escrowId: 'escrow-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockEscrowService.createEscrow.mockResolvedValue(mockEscrow);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      const result = await service.createCustody(userId, dto);

      expect(result).toEqual(mockCustody);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should create custody record without depositAmount', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 14,
      };

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
        breed: 'Golden Retriever',
        age: 3,
        description: 'Friendly dog',
        imageUrl: 'https://example.com/buddy.jpg',
      };

      const mockCustody = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: new Date(),
        depositAmount: null,
        escrowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      const result = await service.createCustody(userId, dto);

      expect(result).toEqual(mockCustody);
      expect(mockEscrowService.createEscrow).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should create escrow when depositAmount is provided', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 14,
        depositAmount: 250.50,
      };

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      };

      const mockEscrow = {
        id: 'escrow-456',
        stellarPublicKey: 'ESCROW_PUBLIC_KEY',
        stellarSecretEncrypted: 'ENCRYPTED_SECRET',
        amount: 250.50,
        status: 'CREATED',
      };

      const mockCustody = {
        id: 'custody-456',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: new Date(),
        depositAmount: 250.50,
        escrowId: 'escrow-456',
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockEscrowService.createEscrow.mockResolvedValue(mockEscrow);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      const result = await service.createCustody(userId, dto);

      expect(result).toBeDefined();
      expect(result.escrowId).toBe('escrow-456');
      expect(mockEscrowService.createEscrow).toHaveBeenCalledWith(
        250.50,
        expect.anything(),
      );
    });

    it('should rollback transaction if escrow creation fails', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 14,
        depositAmount: 100,
      };

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockEscrowService.createEscrow.mockRejectedValue(
        new Error('Escrow creation failed'),
      );
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      await expect(service.createCustody(userId, dto)).rejects.toThrow(
        'Escrow creation failed',
      );
    });

    it('should log CUSTODY_STARTED event after successful custody creation', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const dto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: futureDate.toISOString(),
        durationDays: 14,
        depositAmount: 100,
      };

      const expectedEndDate = new Date(futureDate);
      expectedEndDate.setDate(expectedEndDate.getDate() + 14);

      const mockPet = {
        id: 'pet-123',
        name: 'Buddy',
        species: 'DOG',
      };

      const mockCustody = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        holderId: userId,
        petId: 'pet-123',
        startDate: new Date(dto.startDate),
        endDate: expectedEndDate,
        depositAmount: 100,
        escrowId: 'escrow-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: mockPet,
      };

      mockPrismaService.pet.findUnique.mockResolvedValue(mockPet);
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockEscrowService.createEscrow.mockResolvedValue({
        id: 'escrow-123',
        stellarPublicKey: 'ESCROW_PUBLIC_KEY',
        stellarSecretEncrypted: 'ENCRYPTED_SECRET',
        amount: 100,
        status: 'CREATED',
      });
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          custody: {
            create: jest.fn().mockResolvedValue(mockCustody),
          },
        };
        return callback(mockTx);
      });

      await service.createCustody(userId, dto);

      expect(mockEventsService.logEvent).toHaveBeenCalledWith({
        entityType: 'CUSTODY',
        entityId: 'custody-123',
        eventType: 'CUSTODY_STARTED',
        actorId: userId,
        payload: {
          petId: 'pet-123',
          startDate: mockCustody.startDate,
          endDate: mockCustody.endDate,
          depositAmount: 100,
        },
      });
    });
  });
});
