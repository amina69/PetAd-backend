import { Test, TestingModule } from '@nestjs/testing';
import { PetAvailabilityService } from './pet-availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, CustodyStatus } from '@prisma/client';
import { PetStatus } from '../../common/enums/pet-status.enum';

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

  describe('resolve()', () => {
    const petId = 'pet-123';

    it('returns ADOPTED when a COMPLETED adoption exists (highest priority)', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce({ id: 'adoption-1' }) // COMPLETED check
        .mockResolvedValueOnce(null); // PENDING check (should not be reached)
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.ADOPTED);
      // Only the COMPLETED adoption query should have been called
      expect(mockPrisma.adoption.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.adoption.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            petId,
            status: AdoptionStatus.COMPLETED,
          }),
        }),
      );
    });

    it('returns IN_CUSTODY when an ACTIVE custody exists and no completed adoption', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValueOnce(null); // no COMPLETED adoption
      mockPrisma.custody.findFirst.mockResolvedValueOnce({ id: 'custody-1' }); // ACTIVE custody

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.IN_CUSTODY);
      expect(mockPrisma.custody.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            petId,
            status: CustodyStatus.ACTIVE,
          }),
        }),
      );
    });

    it('returns PENDING when an in-progress adoption exists (REQUESTED)', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce(null) // no COMPLETED adoption
        .mockResolvedValueOnce({ id: 'adoption-2' }); // REQUESTED adoption
      mockPrisma.custody.findFirst.mockResolvedValueOnce(null); // no ACTIVE custody

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('returns PENDING when an in-progress adoption exists (PENDING status)', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'adoption-3' });
      mockPrisma.custody.findFirst.mockResolvedValueOnce(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
      expect(mockPrisma.adoption.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            petId,
            status: {
              in: expect.arrayContaining([
                AdoptionStatus.REQUESTED,
                AdoptionStatus.PENDING,
                AdoptionStatus.APPROVED,
                AdoptionStatus.ESCROW_FUNDED,
              ]),
            },
          }),
        }),
      );
    });

    it('returns PENDING when an APPROVED adoption exists', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'adoption-4' });
      mockPrisma.custody.findFirst.mockResolvedValueOnce(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('returns PENDING when an ESCROW_FUNDED adoption exists', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'adoption-5' });
      mockPrisma.custody.findFirst.mockResolvedValueOnce(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('returns AVAILABLE when no blocking records exist', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('ADOPTED overrides IN_CUSTODY (priority check)', async () => {
      // Even if there were an active custody, a completed adoption takes priority
      mockPrisma.adoption.findFirst.mockResolvedValueOnce({ id: 'adoption-1' }); // COMPLETED
      // custody check should never be reached
      mockPrisma.custody.findFirst.mockResolvedValue({ id: 'custody-1' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.ADOPTED);
      expect(mockPrisma.custody.findFirst).not.toHaveBeenCalled();
    });

    it('IN_CUSTODY overrides PENDING (priority check)', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce(null) // no COMPLETED adoption
        .mockResolvedValueOnce({ id: 'adoption-2' }); // PENDING adoption (should not be reached)
      mockPrisma.custody.findFirst.mockResolvedValueOnce({ id: 'custody-1' }); // ACTIVE custody

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.IN_CUSTODY);
      // The pending adoption query should not have been called
      expect(mockPrisma.adoption.findFirst).toHaveBeenCalledTimes(1);
    });

    it('returns AVAILABLE when only REJECTED adoptions exist', async () => {
      // REJECTED adoptions are excluded from all checks
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('returns AVAILABLE when only CANCELLED adoptions exist', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('returns AVAILABLE when only RETURNED custody exists', async () => {
      // RETURNED custody is not ACTIVE, so it does not block availability
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null); // no ACTIVE custody

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });
  });

  describe('getPetAvailability() — backward-compat wrapper', () => {
    const petId = 'pet-456';

    it('returns true when pet is AVAILABLE', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(true);
    });

    it('returns false when pet is ADOPTED', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValueOnce({ id: 'adoption-1' });

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });

    it('returns false when pet is IN_CUSTODY', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValueOnce(null);
      mockPrisma.custody.findFirst.mockResolvedValueOnce({ id: 'custody-1' });

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });

    it('returns false when pet is PENDING', async () => {
      mockPrisma.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'adoption-2' });
      mockPrisma.custody.findFirst.mockResolvedValueOnce(null);

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });
  });
});
