import { Test, TestingModule } from '@nestjs/testing';
import { PetAvailabilityService } from './pet-availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PetStatus } from '../../common/enums';
import { AdoptionStatus, CustodyStatus } from '@prisma/client';

const mockPrisma = {
  adoption: {
    findFirst: jest.fn(),
  },
  custody: {
    findFirst: jest.fn(),
  },
};

describe('PetAvailabilityService', () => {
  let service: PetAvailabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetAvailabilityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PetAvailabilityService>(PetAvailabilityService);
    jest.clearAllMocks();
  });

  it('returns ADOPTED when latest adoption is COMPLETED', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue({ status: AdoptionStatus.COMPLETED });
    mockPrisma.custody.findFirst.mockResolvedValue(null);

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.ADOPTED);
  });

  it('returns IN_CUSTODY when active custody exists without completed adoption', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue(null);
    mockPrisma.custody.findFirst.mockResolvedValue({ status: CustodyStatus.ACTIVE });

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.IN_CUSTODY);
  });

  it.each([
    [AdoptionStatus.REQUESTED],
    [AdoptionStatus.PENDING],
    [AdoptionStatus.APPROVED],
    [AdoptionStatus.ESCROW_FUNDED],
  ])('returns PENDING when adoption status is %s', async (status) => {
    mockPrisma.adoption.findFirst.mockResolvedValue({ status });
    mockPrisma.custody.findFirst.mockResolvedValue(null);

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.PENDING);
  });

  it('returns AVAILABLE when no adoption or custody records exist', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue(null);
    mockPrisma.custody.findFirst.mockResolvedValue(null);

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('returns ADOPTED even when active custody exists (priority override)', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue({ status: AdoptionStatus.COMPLETED });
    mockPrisma.custody.findFirst.mockResolvedValue({ status: CustodyStatus.ACTIVE });

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.ADOPTED);
  });

  it('returns IN_CUSTODY even when pending adoption exists (priority override)', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue({ status: AdoptionStatus.REQUESTED });
    mockPrisma.custody.findFirst.mockResolvedValue({ status: CustodyStatus.ACTIVE });

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.IN_CUSTODY);
  });

  it('returns AVAILABLE when adoption is REJECTED and no active custody', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue({ status: AdoptionStatus.REJECTED });
    mockPrisma.custody.findFirst.mockResolvedValue(null);

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('returns AVAILABLE when adoption is CANCELLED and no active custody', async () => {
    mockPrisma.adoption.findFirst.mockResolvedValue({ status: AdoptionStatus.CANCELLED });
    mockPrisma.custody.findFirst.mockResolvedValue(null);

    const result = await service.resolve('pet-1');

    expect(result).toBe(PetStatus.AVAILABLE);
  });
});
