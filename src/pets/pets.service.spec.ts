import { Test, TestingModule } from '@nestjs/testing';
import { PetsService } from './pets.service';
import { PrismaService } from '../prisma/prisma.service';
import { PetAvailabilityService } from './services/pet-availability.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreatePetDto } from './dto/create-pet.dto';
import { PetSpecies } from '../common/enums';

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

  it('should find all pets and compute availability', async () => {
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
    expect(result.meta.total).toBe(1);
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
});
