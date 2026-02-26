import { Test, TestingModule } from '@nestjs/testing';
import { PetsController } from '../pets.controller';
import { PetsService } from '../pets.service';
import { UserRole, PetSpecies } from '../../common/enums';
import {
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

describe('PetsController', () => {
  let controller: PetsController;

  const mockPetsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    getPetById: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const mockPet = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Buddy',
    species: PetSpecies.DOG,
    status: 'AVAILABLE',
  };

  const mockRequest = {
    user: {
      sub: '550e8400-e29b-41d4-a716-446655440002',
      role: UserRole.SHELTER,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PetsController],
      providers: [{ provide: PetsService, useValue: mockPetsService }],
    }).compile();

    controller = module.get<PetsController>(PetsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /pets', () => {
    it('should create a new pet', async () => {
      const createPetDto = { name: 'Buddy', species: PetSpecies.DOG };
      mockPetsService.create.mockResolvedValue(mockPet);

      const result = await controller.create(createPetDto, mockRequest);

      expect(result).toEqual(mockPet);
      expect(mockPetsService.create).toHaveBeenCalledWith(createPetDto, mockRequest.user.sub);
    });
  });

  describe('GET /pets', () => {
    it('should return paginated pets list', async () => {
      const searchDto = { page: 1, limit: 10 };
      const expectedResult = {
        data: [mockPet],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      mockPetsService.findAll.mockResolvedValue(expectedResult);

      const result = await controller.findAll(searchDto);

      expect(result).toEqual(expectedResult);
      expect(mockPetsService.findAll).toHaveBeenCalledWith(searchDto);
    });
  });

  describe('GET /pets/:id', () => {
    it('should return pet details', async () => {
      mockPetsService.getPetById.mockResolvedValue(mockPet);

      const result = await controller.getPet(mockPet.id);

      expect(result).toEqual(mockPet);
      expect(mockPetsService.getPetById).toHaveBeenCalledWith(mockPet.id);
    });

    it('should throw NotFoundException if pet not found', async () => {
      mockPetsService.getPetById.mockRejectedValue(new NotFoundException('Pet not found'));

      await expect(controller.getPet('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('PATCH /pets/:id', () => {
    it('should update pet information', async () => {
      const updateDto = { name: 'Updated Buddy' };
      const updatedPet = { ...mockPet, ...updateDto };
      mockPetsService.update.mockResolvedValue(updatedPet);

      const result = await controller.update(mockPet.id, updateDto, mockRequest);

      expect(result).toEqual(updatedPet);
      expect(mockPetsService.update).toHaveBeenCalledWith(
        mockPet.id,
        updateDto,
        mockRequest.user.sub,
        mockRequest.user.role,
      );
    });

    it('should throw ForbiddenException if not authorized', async () => {
      const updateDto = { name: 'Updated Buddy' };
      mockPetsService.update.mockRejectedValue(new ForbiddenException('Not authorized'));

      await expect(controller.update(mockPet.id, updateDto, mockRequest)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('DELETE /pets/:id', () => {
    it('should delete pet if admin', async () => {
      const adminRequest = { user: { ...mockRequest.user, role: UserRole.ADMIN } };
      const deleteResult = { message: 'Pet deleted successfully' };
      mockPetsService.remove.mockResolvedValue(deleteResult);

      const result = await controller.remove(mockPet.id, adminRequest);

      expect(result).toEqual(deleteResult);
      expect(mockPetsService.remove).toHaveBeenCalledWith(mockPet.id, UserRole.ADMIN);
    });

    it('should throw ForbiddenException if not admin', async () => {
      mockPetsService.remove.mockRejectedValue(new ForbiddenException('Only admin can delete'));

      await expect(controller.remove(mockPet.id, mockRequest)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Public Access', () => {
    it('should allow public access to pet listing', async () => {
      const searchDto = { page: 1, limit: 10 };
      mockPetsService.findAll.mockResolvedValue({ data: [], meta: {} });

      await controller.findAll(searchDto);

      expect(mockPetsService.findAll).toHaveBeenCalled();
    });

    it('should allow public access to pet details', async () => {
      mockPetsService.getPetById.mockResolvedValue(mockPet);

      await controller.getPet(mockPet.id);

      expect(mockPetsService.getPetById).toHaveBeenCalledWith(mockPet.id);
    });
  });
});
