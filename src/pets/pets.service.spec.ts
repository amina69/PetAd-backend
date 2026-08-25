import { Test, TestingModule } from '@nestjs/testing';
import { PetsService } from './pets.service';
import { PrismaService } from '../prisma/prisma.service';
import { PetAvailabilityService } from './services/pet-availability.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreatePetDto } from './dto/create-pet.dto';
import { PetSpecies } from '../common/enums';
import { PetStatus } from '../common/enums/pet-status.enum';

const mockPrisma = {
  pet: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
};

const mockAvailabilityService = {
  getPetAvailability: jest.fn(),
  getPetStatus: jest.fn(),
};

describe('PetsService', () => {
  let service: PetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: PetAvailabilityService,
          useValue: mockAvailabilityService,
        },
      ],
    }).compile();

    service = module.get<PetsService>(PetsService);
    jest.clearAllMocks();
  });

  it('should create a pet', async () => {
    const dto: CreatePetDto = {
      name: 'Buddy',
      species: 'DOG',
    } as CreatePetDto;

    const ownerId = 'owner-1';

    mockPrisma.pet.create.mockResolvedValue({
      ...dto,
      currentOwnerId: ownerId,
    });

    const result = await service.create(dto, ownerId);

    expect(result).toMatchObject({
      name: 'Buddy',
      species: 'DOG',
      currentOwnerId: ownerId,
    });
  });

  it('should find all pets and compute availability and status', async () => {
    const mockPets = [
      {
        id: '1',
        name: 'Buddy',
        adoptions: [],
        custodies: [],
        currentOwner: null,
      },
    ];

    mockPrisma.pet.findMany.mockResolvedValue(mockPets);
    mockPrisma.pet.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].isAvailable).toBe(true);
    expect(result.data[0].status).toBe(PetStatus.AVAILABLE);
    expect(result.meta.total).toBe(1);
  });

  it('should expose status as PENDING when pet has active adoption', async () => {
    const mockPets = [
      {
        id: '1',
        name: 'Buddy',
        adoptions: [
          { status: 'REQUESTED', createdAt: new Date('2026-01-01') },
        ],
        custodies: [],
        currentOwner: null,
      },
    ];

    mockPrisma.pet.findMany.mockResolvedValue(mockPets);
    mockPrisma.pet.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].status).toBe(PetStatus.PENDING);
    expect(result.data[0].isAvailable).toBe(false);
  });

  it('should expose status as IN_CUSTODY when pet has active custody', async () => {
    const mockPets = [
      {
        id: '1',
        name: 'Buddy',
        adoptions: [],
        custodies: [{ id: 'custody-1' }],
        currentOwner: null,
      },
    ];

    mockPrisma.pet.findMany.mockResolvedValue(mockPets);
    mockPrisma.pet.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].status).toBe(PetStatus.IN_CUSTODY);
    expect(result.data[0].isAvailable).toBe(false);
  });

  it('should expose status as ADOPTED when pet has completed adoption', async () => {
    const mockPets = [
      {
        id: '1',
        name: 'Buddy',
        adoptions: [
          { status: 'COMPLETED', createdAt: new Date('2026-01-01') },
        ],
        custodies: [],
        currentOwner: null,
      },
    ];

    mockPrisma.pet.findMany.mockResolvedValue(mockPets);
    mockPrisma.pet.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].status).toBe(PetStatus.ADOPTED);
    expect(result.data[0].isAvailable).toBe(false);
  });

  it('should resolve ADOPTED overriding custody in list', async () => {
    const mockPets = [
      {
        id: '1',
        name: 'Buddy',
        adoptions: [
          { status: 'COMPLETED', createdAt: new Date('2026-02-01') },
        ],
        custodies: [{ id: 'custody-1' }],
        currentOwner: null,
      },
    ];

    mockPrisma.pet.findMany.mockResolvedValue(mockPets);
    mockPrisma.pet.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].status).toBe(PetStatus.ADOPTED);
  });

  it('should filter by species', async () => {
    mockPrisma.pet.findMany.mockResolvedValue([]);
    mockPrisma.pet.count.mockResolvedValue(0);

    await service.findAll({ species: PetSpecies.DOG });

    expect(mockPrisma.pet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          species: PetSpecies.DOG,
        }),
      }),
    );
  });

  describe('Ownership Validation', () => {
    it('should allow owner to update their pet', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({
        id: 'pet-1',
        currentOwnerId: 'owner-1',
      });

      mockPrisma.pet.update.mockResolvedValue({
        id: 'pet-1',
        name: 'Updated Buddy',
      });

      const result = await service.update(
        'pet-1',
        { name: 'Updated Buddy' },
        'owner-1',
        'SHELTER',
      );

      expect(result.name).toBe('Updated Buddy');
    });

    it('should throw ForbiddenException for non-owner', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({
        id: 'pet-1',
        currentOwnerId: 'owner-1',
      });

      await expect(
        service.update('pet-1', {}, 'owner-2', 'SHELTER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow ADMIN to update any pet', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({
        id: 'pet-1',
        currentOwnerId: 'owner-1',
      });

      mockPrisma.pet.update.mockResolvedValue({
        id: 'pet-1',
        name: 'Admin Updated',
      });

      const result = await service.update(
        'pet-1',
        { name: 'Admin Updated' },
        'admin-1',
        'ADMIN',
      );

      expect(result.name).toBe('Admin Updated');
    });
  });

  describe('Delete Operations', () => {
    it('should allow ADMIN to delete', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({ id: 'pet-1' });
      mockPrisma.pet.delete.mockResolvedValue({});

      const result = await service.remove('pet-1', 'ADMIN');

      expect(result.message).toBe('Pet deleted successfully');
    });

    it('should throw ForbiddenException for non-admin', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({ id: 'pet-1' });

      await expect(service.remove('pet-1', 'SHELTER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if pet missing', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'ADMIN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('should throw NotFoundException if pet not found', async () => {
    mockPrisma.pet.findUnique.mockResolvedValue(null);

    await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
  });

  it('should return status and isAvailable from getPetById', async () => {
    const mockPet = {
      id: 'pet-1',
      name: 'Buddy',
      currentOwner: { id: 'owner-1' },
    };

    mockPrisma.pet.findUnique.mockResolvedValue(mockPet);
    mockAvailabilityService.getPetStatus.mockResolvedValue(PetStatus.PENDING);

    const result = await service.getPetById('pet-1');

    expect(result.status).toBe(PetStatus.PENDING);
    expect(result.isAvailable).toBe(false);
    expect(result.name).toBe('Buddy');
  });

  it('should return status AVAILABLE from getPetById when pet has no adoptions or custody', async () => {
    const mockPet = {
      id: 'pet-1',
      name: 'Buddy',
      currentOwner: null,
    };

    mockPrisma.pet.findUnique.mockResolvedValue(mockPet);
    mockAvailabilityService.getPetStatus.mockResolvedValue(PetStatus.AVAILABLE);

    const result = await service.getPetById('pet-1');

    expect(result.status).toBe(PetStatus.AVAILABLE);
    expect(result.isAvailable).toBe(true);
  });
});
