import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AdoptionStatus } from '@prisma/client';
import { Role } from '../auth/enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';
import { AdoptionService } from './adoption.service';

describe('AdoptionService', () => {
  let service: AdoptionService;

  const mockPrismaService = {
    adoption: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdoptionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AdoptionService>(AdoptionService);
  });

  it('should apply adopter filter for regular users', async () => {
    mockPrismaService.adoption.findMany.mockResolvedValue([
      {
        id: 'adoption-1',
        status: AdoptionStatus.PENDING,
        notes: 'I love dogs',
        createdAt: new Date('2026-02-19T10:00:00.000Z'),
        pet: {
          id: 'pet-1',
          name: 'Buddy',
          species: 'DOG',
          imageUrl: 'https://cdn.test/pet-1.jpg',
        },
        adopter: {
          id: 'user-1',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
      },
    ]);

    const result = await service.findAll(
      { userId: 'user-1', email: 'john@example.com', role: Role.USER },
      {},
    );

    expect(mockPrismaService.adoption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { adopterId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result).toEqual([
      {
        id: 'adoption-1',
        status: AdoptionStatus.PENDING,
        reason: 'I love dogs',
        createdAt: new Date('2026-02-19T10:00:00.000Z'),
        pet: {
          id: 'pet-1',
          name: 'Buddy',
          species: 'DOG',
          imageUrl: 'https://cdn.test/pet-1.jpg',
          images: ['https://cdn.test/pet-1.jpg'],
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
        },
      },
    ]);
  });

  it('should apply shelter and optional filters for shelter users', async () => {
    mockPrismaService.adoption.findMany.mockResolvedValue([]);

    await service.findAll(
      { userId: 'shelter-1', email: 'shelter@example.com', role: Role.SHELTER },
      { status: AdoptionStatus.PENDING, petId: 'pet-1' },
    );

    expect(mockPrismaService.adoption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: AdoptionStatus.PENDING,
          petId: 'pet-1',
          pet: { currentOwnerId: 'shelter-1' },
        },
      }),
    );
  });

  it('should return all records for admin unless optional filters are provided', async () => {
    mockPrismaService.adoption.findMany.mockResolvedValue([]);

    await service.findAll(
      { userId: 'admin-1', email: 'admin@example.com', role: Role.ADMIN },
      {},
    );

    expect(mockPrismaService.adoption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    );
  });

  it('should return empty array when no adoptions are found', async () => {
    mockPrismaService.adoption.findMany.mockResolvedValue([]);

    const result = await service.findAll(
      { userId: 'user-1', email: 'john@example.com', role: Role.USER },
      {},
    );

    expect(result).toEqual([]);
  });

  it('should throw for unsupported roles', async () => {
    await expect(
      service.findAll(
        { userId: 'x-1', email: 'x@example.com', role: 'UNKNOWN' },
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockPrismaService.adoption.findMany).not.toHaveBeenCalled();
  });
});
