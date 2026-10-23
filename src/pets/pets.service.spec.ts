import { Test, TestingModule } from '@nestjs/testing';
import { PetsService } from './pets.service';
import { PrismaService } from '../prisma/prisma.service';
import { PetsRepository } from './pets.repository';
import { PetAvailabilityService } from './services/pet-availability.service';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CreatePetDto } from './dto/create-pet.dto';
import { PetSpecies } from '../common/enums';

type MockPetFindManyArgs = {
  where?: { species?: PetSpecies };
  select?: { id?: boolean };
};

const mockPrisma = {
  pet: {
    create: jest.fn(),
    findMany: jest.fn<Promise<unknown[]>, [MockPetFindManyArgs]>(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
};

const mockPetsRepository = {
  findIdsWithinRadius: jest.fn(),
};

const mockAvailabilityService = {
  getPetAvailability: jest.fn(),
  resolve: jest.fn(),
};

describe('PetsService', () => {
  let service: PetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PetsRepository, useValue: mockPetsRepository },
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
    mockAvailabilityService.resolve.mockResolvedValue('AVAILABLE');

    const result = await service.findAll({});

    expect(result.data[0].isAvailable).toBe(true);
    expect(result.data[0].computedStatus).toBe('AVAILABLE');
    expect(result.meta.total).toBe(1);
  });

  it('hides pets owned by suspended accounts from public search', async () => {
    mockPrisma.pet.findMany.mockResolvedValue([]);
    mockPrisma.pet.count.mockResolvedValue(0);

    await service.findAll({});

    const [[findManyCall]] = mockPrisma.pet.findMany.mock.calls as unknown as [
      [{ where: { AND: unknown[] } }],
    ];
    const [[countCall]] = mockPrisma.pet.count.mock.calls as unknown as [
      [{ where: { AND: unknown[] } }],
    ];

    expect(findManyCall.where.AND).toEqual([
      {
        OR: [{ currentOwnerId: null }, { currentOwner: { status: 'ACTIVE' } }],
      },
    ]);
    expect(countCall.where.AND).toHaveLength(1);
  });

  it("keeps suspended owners' pets visible to admins", async () => {
    mockPrisma.pet.findMany.mockResolvedValue([]);
    mockPrisma.pet.count.mockResolvedValue(0);

    await service.findAll({}, { role: 'ADMIN' });

    const [[findManyCall]] = mockPrisma.pet.findMany.mock.calls as unknown as [
      [{ where: Record<string, unknown> }],
    ];

    expect(findManyCall.where.AND).toBeUndefined();
  });

  it('should filter by species', async () => {
    mockPrisma.pet.findMany.mockResolvedValue([]);
    mockPrisma.pet.count.mockResolvedValue(0);

    await service.findAll({ species: PetSpecies.DOG });

    const findManyArgs = mockPrisma.pet.findMany.mock.calls[0][0];
    expect(findManyArgs.where?.species).toBe(PetSpecies.DOG);
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

  describe('Location rounding (~100 m)', () => {
    it('should round coordinates to 3 decimal places on create', async () => {
      const dto = {
        name: 'Buddy',
        species: PetSpecies.DOG,
        latitude: 52.5200349,
        longitude: 13.4049549,
      } as CreatePetDto;

      mockPrisma.pet.create.mockImplementation(({ data }) =>
        Promise.resolve(data),
      );

      const result = await service.create(dto, 'owner-1');

      expect(result.latitude).toBe(52.52);
      expect(result.longitude).toBe(13.405);
    });

    it('should round coordinates to 3 decimal places on update', async () => {
      mockPrisma.pet.findUnique.mockResolvedValue({
        id: 'pet-1',
        currentOwnerId: 'owner-1',
      });
      mockPrisma.pet.update.mockImplementation(({ data }) =>
        Promise.resolve(data),
      );

      const result = await service.update(
        'pet-1',
        { latitude: 48.8566149999, longitude: 2.3522219999 },
        'owner-1',
        'SHELTER',
      );

      expect(result.latitude).toBe(48.857);
      expect(result.longitude).toBe(2.352);
    });
  });

  describe('Geo search (near/radius)', () => {
    const near = '52.5200,13.4050';

    it('should query the repository and attach distanceKm when near is supplied', async () => {
      mockPetsRepository.findIdsWithinRadius.mockResolvedValue([
        { id: 'pet-near', distanceKm: 1.23 },
      ]);
      mockPrisma.pet.findMany.mockImplementation(
        (args: { select?: { id?: boolean } }) =>
          Promise.resolve(
            args?.select?.id
              ? [{ id: 'pet-near' }]
              : [
                  {
                    id: 'pet-near',
                    name: 'Nearby',
                    adoptions: [],
                    custodies: [],
                    currentOwner: null,
                  },
                ],
          ),
      );
      mockAvailabilityService.resolve.mockResolvedValue('AVAILABLE');

      const result = await service.findAll({ near, radius: 5 });

      expect(mockPetsRepository.findIdsWithinRadius).toHaveBeenCalledWith(
        52.52,
        13.405,
        5,
      );
      expect(result.data[0].id).toBe('pet-near');
      expect(result.data[0].distanceKm).toBe(1.23);
      expect(result.data[0].isAvailable).toBe(true);
      expect(result.meta.total).toBe(1);
    });

    it('should not expose distanceKm when near is not supplied', async () => {
      mockPrisma.pet.findMany.mockResolvedValue([
        { id: '1', adoptions: [], custodies: [], currentOwner: null },
      ]);
      mockPrisma.pet.count.mockResolvedValue(1);
      mockAvailabilityService.resolve.mockResolvedValue('AVAILABLE');

      const result = await service.findAll({});

      expect(result.data[0]).not.toHaveProperty('distanceKm');
    });

    it('should default to a 10 km radius when near is supplied without radius', async () => {
      mockPetsRepository.findIdsWithinRadius.mockResolvedValue([]);

      const result = await service.findAll({ near });

      expect(mockPetsRepository.findIdsWithinRadius).toHaveBeenCalledWith(
        52.52,
        13.405,
        10,
      );
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('should cap the radius at 200 km', async () => {
      mockPetsRepository.findIdsWithinRadius.mockResolvedValue([]);

      await service.findAll({ near, radius: 5000 });

      expect(mockPetsRepository.findIdsWithinRadius).toHaveBeenCalledWith(
        52.52,
        13.405,
        200,
      );
    });

    it('should combine geo candidates with other filters and paginate nearest-first', async () => {
      mockPetsRepository.findIdsWithinRadius.mockResolvedValue([
        { id: 'a', distanceKm: 1 },
        { id: 'b', distanceKm: 2 },
        { id: 'c', distanceKm: 3 },
      ]);
      // 'b' is filtered out by the species filter.
      mockPrisma.pet.findMany.mockImplementation(
        (args: { select?: { id?: boolean } }) =>
          Promise.resolve(
            args?.select?.id
              ? [{ id: 'a' }, { id: 'c' }]
              : [
                  {
                    id: 'c',
                    name: 'Third',
                    adoptions: [],
                    custodies: [],
                    currentOwner: null,
                  },
                ],
          ),
      );
      mockAvailabilityService.resolve.mockResolvedValue('AVAILABLE');

      const result = await service.findAll({
        near,
        species: PetSpecies.DOG,
        page: 2,
        limit: 1,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('c');
      // Total counts only the filtered candidates (a, c), not raw candidates.
      expect(result.meta.total).toBe(2);
    });

    it('should reject an out-of-range latitude in near', async () => {
      await expect(service.findAll({ near: '999,13.405' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject an out-of-range longitude in near', async () => {
      await expect(service.findAll({ near: '52.52,999' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
