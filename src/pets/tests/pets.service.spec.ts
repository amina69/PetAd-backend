import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PetsService } from '../pets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, PetSpecies } from '../../common/enums';
import { ComputedPetStatus, PetAvailabilityService } from '../pet-availability.service';

describe('PetsService', () => {
  let service: PetsService;
  let mockPrisma: any;
  let mockAvailabilityService: any;

  const mockPet = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Buddy',
    species: PetSpecies.DOG,
    breed: 'Golden Retriever',
    age: 3,
    description: 'Friendly dog',
    imageUrl: 'https://example.com/buddy.jpg',
    currentOwnerId: '550e8400-e29b-41d4-a716-446655440001',
  };

  beforeEach(async () => {
    mockPrisma = {
      pet: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    mockAvailabilityService = {
      getPetWithAvailability: jest.fn(),
      getPetsWithAvailability: jest.fn(),
      resolve: jest.fn(),
      resolveBatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PetAvailabilityService, useValue: mockAvailabilityService },
      ],
    }).compile();

    service = module.get<PetsService>(PetsService);
  });

  describe('create', () => {
    it('should create a new pet', async () => {
      const createDto = {
        name: 'Buddy',
        species: PetSpecies.DOG,
        breed: 'Golden Retriever',
      };
      const ownerId = 'owner-123';
      
      mockPrisma.pet.create.mockResolvedValue({
        ...mockPet,
        ...createDto,
        currentOwnerId: ownerId,
      });

      const result = await service.create(createDto, ownerId);

      expect(mockPrisma.pet.create).toHaveBeenCalledWith({
        data: {
          ...createDto,
          currentOwnerId: ownerId,
        },
        include: { currentOwner: true },
      });
      expect(result).toMatchObject({
        ...createDto,
        currentOwnerId: ownerId,
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated results with computed availability', async () => {
      const mockPets = [mockPet];
      const availabilityMap = new Map([['pet-1', ComputedPetStatus.AVAILABLE]]);
      
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(
        mockPets.map(pet => ({ ...pet, status: ComputedPetStatus.AVAILABLE }))
      );
      mockAvailabilityService.resolveBatch.mockResolvedValue(availabilityMap);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(mockAvailabilityService.getPetsWithAvailability).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });

    it('should filter by computed status', async () => {
      const mockPets = [mockPet];
      
      mockAvailabilityService.getPetsWithAvailability.mockResolvedValue(
        mockPets.map(pet => ({ ...pet, status: ComputedPetStatus.ADOPTED }))
      );

      const result = await service.findAll({ status: ComputedPetStatus.ADOPTED });

      expect(result.data).toHaveLength(1);
      expect((result.data as any)[0].status).toBe(ComputedPetStatus.ADOPTED);
    });
  });

  describe('findOne', () => {
    it('should return pet with computed availability', async () => {
      const petWithAvailability = {
        ...mockPet,
        status: ComputedPetStatus.AVAILABLE,
      };
      
      mockAvailabilityService.getPetWithAvailability.mockResolvedValue(petWithAvailability);

      const result = await service.findOne(mockPet.id);

      expect(result).toEqual(petWithAvailability);
      expect(mockAvailabilityService.getPetWithAvailability).toHaveBeenCalledWith(mockPet.id);
    });

    it('should throw error if pet not found', async () => {
      mockAvailabilityService.getPetWithAvailability.mockRejectedValue(
        new Error('Pet with ID not-found not found')
      );

      await expect(service.findOne('not-found')).rejects.toThrow(Error);
    });
  });

  describe('update', () => {
    it('should update pet and return with computed availability', async () => {
      const updateDto = { name: 'Updated Buddy' };
      const updatedPet = { ...mockPet, ...updateDto };
      const petWithAvailability = {
        ...updatedPet,
        status: ComputedPetStatus.AVAILABLE,
      };
      
      mockPrisma.pet.findUnique.mockResolvedValue({
        ...mockPet,
        currentOwnerId: 'owner-123', // Match the userId
      });
      mockPrisma.pet.update.mockResolvedValue(updatedPet);
      mockAvailabilityService.getPetWithAvailability.mockResolvedValue(petWithAvailability);

      const result = await service.update(mockPet.id, updateDto, 'owner-123', 'SHELTER');

      expect(mockPrisma.pet.update).toHaveBeenCalledWith({
        where: { id: mockPet.id },
        data: updateDto,
        include: { currentOwner: true },
      });
      expect(result.status).toBe(ComputedPetStatus.AVAILABLE);
    });

    it('should throw ForbiddenException if not owner or admin', async () => {
      const updateDto = { name: 'Updated Buddy' };
      
      mockPrisma.pet.findUnique.mockResolvedValue({
        ...mockPet,
        currentOwnerId: 'different-owner',
      });

      await expect(
        service.update(mockPet.id, updateDto, 'user-123', 'USER')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if pet not found', async () => {
      const updateDto = { name: 'Updated Buddy' };
      
      mockPrisma.pet.findUnique.mockResolvedValue(null);

      await expect(
        service.update('not-found', updateDto, 'user-123', 'USER')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete pet if admin', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue(mockPet);
      mockPrisma.pet.delete.mockResolvedValue(mockPet);

      const result = await service.remove(mockPet.id, 'ADMIN');

      expect(mockPrisma.pet.delete).toHaveBeenCalledWith({ where: { id: mockPet.id } });
      expect(result).toEqual({ message: 'Pet deleted successfully' });
    });

    it('should throw ForbiddenException if not admin', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue(mockPet);

      await expect(service.remove(mockPet.id, 'USER')).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if pet not found', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue(null);

      await expect(service.remove('not-found', 'ADMIN')).rejects.toThrow(NotFoundException);
    });
  });
});
