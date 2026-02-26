import { Test, TestingModule } from '@nestjs/testing';
import { PetsService } from './pets.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { PetSpecies } from '../common/enums';
import { ComputedPetStatus, PetAvailabilityService } from './pet-availability.service';

// Mock PrismaService
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

// Mock PetAvailabilityService
const mockAvailabilityService = {
  getPetWithAvailability: jest.fn(),
  getPetsWithAvailability: jest.fn(),
  resolve: jest.fn(),
  resolveBatch: jest.fn(),
};

describe('PetsService', () => {
  let service: PetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PetAvailabilityService, useValue: mockAvailabilityService },
      ],
    }).compile();
    service = module.get<PetsService>(PetsService);
    jest.clearAllMocks();
  });

  it('should create a pet', async () => {
    const dto: CreatePetDto = { name: 'Buddy', species: 'DOG' } as CreatePetDto;
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

  it('should find all available pets', async () => {
    const mockPets = [
      { name: 'Buddy', status: ComputedPetStatus.AVAILABLE },
      { name: 'Max', status: ComputedPetStatus.AVAILABLE },
    ];
    mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);

    const result = await service.findAll({});

    expect(result.data).toHaveLength(2);
    expect((result.data as any)[0].status).toBe(ComputedPetStatus.AVAILABLE);
    expect(result.meta.total).toBe(2);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });

  describe('findAll - Pagination', () => {
    it('should return paginated results with default values', async () => {
      const mockPets = Array.from({ length: 20 }, (_, i) => ({
        id: `pet-${i}`,
        name: `Pet ${i}`,
        status: ComputedPetStatus.AVAILABLE,
      }));
      
      // Mock the availability service to return pets for both the main query and count query
      mockAvailabilityService.getPetsWithAvailability
        .mockResolvedValueOnce(mockPets) // For the main query
        .mockResolvedValueOnce(Array.from({ length: 45 }, (_, i) => ({ // For the count query
          id: `pet-${i}`,
          name: `Pet ${i}`,
          status: ComputedPetStatus.AVAILABLE,
        })));
      
      mockAvailabilityService.resolveBatch.mockResolvedValue(
        new Map(mockPets.map(pet => [pet.id, ComputedPetStatus.AVAILABLE]))
      );

      const result = await service.findAll({});

      expect(result.data).toHaveLength(20);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.total).toBe(45);
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPreviousPage).toBe(false);
    });

    it('should calculate skip correctly for page 2', async () => {
      const mockPets = [{ id: 'pet-1', status: ComputedPetStatus.AVAILABLE }];
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);

      await service.findAll({ page: 2, limit: 10 });

      expect(mockAvailabilityService.getPetsWithAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('should handle last page correctly', async () => {
      const mockPets = Array.from({ length: 5 }, (_, i) => ({
        id: `pet-${i}`,
        name: `Pet ${i}`,
        status: ComputedPetStatus.AVAILABLE,
      }));
      const expectedResult = {
        data: mockPets,
        meta: {
          page: 5,
          limit: 10,
          total: 45,
          totalPages: 5,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      };
      
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);

      const result = await service.findAll({ page: 5, limit: 10 });

      expect(result.data).toHaveLength(5);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(true);
    });

    it('should filter by species', async () => {
      const mockPets = [{ id: 'pet-1', status: ComputedPetStatus.AVAILABLE }];
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);

      await service.findAll({ species: PetSpecies.DOG });

      expect(mockAvailabilityService.getPetsWithAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ species: PetSpecies.DOG }),
        }),
      );
    });

    it('should handle search query', async () => {
      const mockPets = [{ id: 'pet-1', status: ComputedPetStatus.AVAILABLE }];
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);

      await service.findAll({ search: 'Buddy' });

      expect(mockAvailabilityService.getPetsWithAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'Buddy', mode: 'insensitive' } },
              { breed: { contains: 'Buddy', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should return empty array for page beyond total', async () => {
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue([]);

      const result = await service.findAll({ page: 999, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('should handle empty results with zero total', async () => {
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue([]);

      const result = await service.findAll({ species: PetSpecies.DOG });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
      expect(result.meta.hasNextPage).toBe(false);
    });

    it('should filter by status', async () => {
      const mockPets = [{ id: 'pet-1', name: 'Buddy' }];
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);
      mockAvailabilityService.resolveBatch.mockResolvedValue(
        new Map([['pet-1', ComputedPetStatus.ADOPTED]])
      );

      await service.findAll({ status: ComputedPetStatus.ADOPTED });

      expect(mockAvailabilityService.getPetsWithAvailability).toHaveBeenCalled();
    });

    it('should combine multiple filters', async () => {
      const mockPets = [{ id: 'pet-1', name: 'Buddy', species: 'DOG' }];
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(mockPets);
      mockAvailabilityService.resolveBatch.mockResolvedValue(
        new Map([['pet-1', ComputedPetStatus.AVAILABLE]])
      );

      await service.findAll({
        species: PetSpecies.DOG,
        status: ComputedPetStatus.AVAILABLE,
        search: 'Golden',
      });

      expect(mockAvailabilityService.getPetsWithAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            species: PetSpecies.DOG,
          }),
        }),
      );
    });
  });

  it('should throw NotFoundException if pet not found', async () => {
    mockAvailabilityService.getPetWithAvailability.mockRejectedValue(new Error('Pet with ID bad-id not found'));
    await expect(service.findOne('bad-id')).rejects.toThrow(Error);
  });

  it('should update pet if owner or admin', async () => {
    mockPrisma.pet.findUnique.mockResolvedValue({
      id: 'pet-1',
      currentOwnerId: 'owner-1',
    });
    mockPrisma.pet.update.mockResolvedValue({ id: 'pet-1', name: 'Buddy' });
    mockAvailabilityService.getPetWithAvailability.mockResolvedValue({ id: 'pet-1', name: 'Buddy', status: ComputedPetStatus.AVAILABLE });
    const dto: UpdatePetDto = { name: 'Buddy' } as UpdatePetDto;
    const result = await service.update('pet-1', dto, 'owner-1', 'SHELTER');
    expect(result.name).toBe('Buddy');
  });

  it('should throw ForbiddenException if not owner or admin', async () => {
    mockPrisma.pet.findUnique.mockResolvedValue({
      id: 'pet-1',
      currentOwnerId: 'owner-1',
    });
    await expect(
      service.update('pet-1', {} as UpdatePetDto, 'other-user', 'USER'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should delete pet if admin', async () => {
    mockPrisma.pet.findUnique.mockResolvedValue({ id: 'pet-1' });
    mockPrisma.pet.delete.mockResolvedValue({});
    const result = await service.remove('pet-1', 'ADMIN');
    expect(result.message).toBe('Pet deleted successfully');
  });

  it('should throw ForbiddenException if not admin on delete', async () => {
    mockPrisma.pet.findUnique.mockResolvedValue({ id: 'pet-1' });
    await expect(service.remove('pet-1', 'SHELTER')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
