import { Test, TestingModule } from '@nestjs/testing';
import { PetAvailabilityService } from './pet-availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PetStatus } from '../../common/enums/pet-status.enum';

describe('PetAvailabilityService', () => {
  let service: PetAvailabilityService;

  const mockAdoptionFindFirst = jest.fn();
  const mockCustodyFindFirst = jest.fn();

  const mockPrisma = {
    adoption: { findFirst: mockAdoptionFindFirst },
    custody: { findFirst: mockCustodyFindFirst },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetAvailabilityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PetAvailabilityService>(PetAvailabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolve', () => {
    const petId = 'pet-123';

    it('should return AVAILABLE when no adoption or custody exists', async () => {
      // Two calls to adoption.findFirst: COMPLETED check, then pending check
      mockAdoptionFindFirst.mockResolvedValue(null);
      mockCustodyFindFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('should return ADOPTED when a COMPLETED adoption exists', async () => {
      // First call (COMPLETED check) returns a result → short-circuits
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-completed' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.ADOPTED);
      // Should NOT check custody or pending adoptions
      expect(mockCustodyFindFirst).not.toHaveBeenCalled();
      expect(mockAdoptionFindFirst).toHaveBeenCalledTimes(1);
    });

    it('should return IN_CUSTODY when an ACTIVE custody exists (no completed adoption)', async () => {
      // adoption.findFirst call 1 (COMPLETED): null
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      // custody.findFirst (ACTIVE): found
      mockCustodyFindFirst.mockResolvedValueOnce({ id: 'custody-active' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.IN_CUSTODY);
      expect(mockCustodyFindFirst).toHaveBeenCalledWith({
        where: { petId, status: 'ACTIVE' },
        select: { id: true },
      });
      // Should NOT check pending adoptions
      expect(mockAdoptionFindFirst).toHaveBeenCalledTimes(1);
    });

    it('should return PENDING when a REQUESTED adoption exists', async () => {
      // adoption.findFirst call 1 (COMPLETED): null
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      // custody.findFirst (ACTIVE): null
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      // adoption.findFirst call 2 (pending): found
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-requested' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('should return PENDING when a PENDING adoption exists', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-pending' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('should return PENDING when an APPROVED adoption exists', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-approved' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('should return PENDING when an ESCROW_FUNDED adoption exists', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-escrow' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('should return AVAILABLE when adoption is REJECTED (not in pending list)', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      // pending adoption check returns null (REJECTED not in the status list)
      mockAdoptionFindFirst.mockResolvedValueOnce(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('should return AVAILABLE when adoption is CANCELLED (not in pending list)', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce(null);

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('should prioritize ADOPTED over IN_CUSTODY', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-completed' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.ADOPTED);
      expect(mockCustodyFindFirst).not.toHaveBeenCalled();
    });

    it('should prioritize IN_CUSTODY over PENDING', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce({ id: 'custody-active' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.IN_CUSTODY);
      // Should NOT proceed to pending check
      expect(mockAdoptionFindFirst).toHaveBeenCalledTimes(1);
    });

    it('should prioritize PENDING over AVAILABLE', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-requested' });

      const result = await service.resolve(petId);

      expect(result).toBe(PetStatus.PENDING);
    });

    it('should query the correct adoption statuses for pending check', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce(null);

      await service.resolve(petId);

      expect(mockAdoptionFindFirst).toHaveBeenNthCalledWith(2, {
        where: {
          petId,
          status: {
            in: [
              'REQUESTED',
              'PENDING',
              'APPROVED',
              'ESCROW_FUNDED',
            ],
          },
        },
        select: { id: true },
      });
    });
  });

  describe('getPetAvailability (legacy)', () => {
    const petId = 'pet-123';

    it('should return true when status is AVAILABLE', async () => {
      mockAdoptionFindFirst.mockResolvedValue(null);
      mockCustodyFindFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(true);
    });

    it('should return false when status is ADOPTED', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-completed' });

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });

    it('should return false when status is IN_CUSTODY', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce({ id: 'custody-active' });

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });

    it('should return false when status is PENDING', async () => {
      mockAdoptionFindFirst.mockResolvedValueOnce(null);
      mockCustodyFindFirst.mockResolvedValueOnce(null);
      mockAdoptionFindFirst.mockResolvedValueOnce({ id: 'adoption-requested' });

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });
  });
});
