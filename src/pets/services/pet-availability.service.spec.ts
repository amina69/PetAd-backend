import { Test, TestingModule } from '@nestjs/testing';
import {
  PetAvailabilityService,
  computePetStatus,
  PET_AVAILABILITY_CHANGED,
} from './pet-availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PetStatus } from '../../common/enums/pet-status.enum';
import { AdoptionStatus, CustodyStatus, EventEntityType } from '@prisma/client';

describe('computePetStatus', () => {
  it('returns ADOPTED when latest adoption is COMPLETED', () => {
    expect(computePetStatus(AdoptionStatus.COMPLETED, false)).toBe(
      PetStatus.ADOPTED,
    );
  });

  it('returns ADOPTED even with active custody (adopted overrides custody)', () => {
    expect(computePetStatus(AdoptionStatus.COMPLETED, true)).toBe(
      PetStatus.ADOPTED,
    );
  });

  it('returns IN_CUSTODY with active custody and no adoption', () => {
    expect(computePetStatus(null, true)).toBe(PetStatus.IN_CUSTODY);
  });

  it('returns IN_CUSTODY over each pending-state adoption (custody overrides pending)', () => {
    const pendingStates = [
      AdoptionStatus.REQUESTED,
      AdoptionStatus.PENDING,
      AdoptionStatus.APPROVED,
      AdoptionStatus.ESCROW_FUNDED,
    ];
    for (const status of pendingStates) {
      expect(computePetStatus(status, true)).toBe(PetStatus.IN_CUSTODY);
    }
  });

  it('returns PENDING for REQUESTED without custody', () => {
    expect(computePetStatus(AdoptionStatus.REQUESTED, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns PENDING for PENDING without custody', () => {
    expect(computePetStatus(AdoptionStatus.PENDING, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns PENDING for APPROVED without custody', () => {
    expect(computePetStatus(AdoptionStatus.APPROVED, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns PENDING for ESCROW_FUNDED without custody', () => {
    expect(computePetStatus(AdoptionStatus.ESCROW_FUNDED, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('falls through to AVAILABLE when latest adoption is REJECTED', () => {
    expect(computePetStatus(AdoptionStatus.REJECTED, false)).toBe(
      PetStatus.AVAILABLE,
    );
  });

  it('falls through to AVAILABLE when latest adoption is CANCELLED', () => {
    expect(computePetStatus(AdoptionStatus.CANCELLED, true)).toBe(
      PetStatus.AVAILABLE,
    );
  });

  it('returns AVAILABLE with no adoption and no custody', () => {
    expect(computePetStatus(null, false)).toBe(PetStatus.AVAILABLE);
  });
});

describe('PetAvailabilityService', () => {
  let service: PetAvailabilityService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    adoption: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    custody: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    eventLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetAvailabilityService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PetAvailabilityService>(PetAvailabilityService);
    prisma = module.get(PrismaService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('resolve', () => {
    const petId = 'test-pet-id';

    it('should return AVAILABLE when no adoptions or custodies exist', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result.status).toBe(PetStatus.AVAILABLE);
      expect(result.hasCompletedAdoption).toBe(false);
      expect(result.hasActiveCustody).toBe(false);
      expect(result.hasPendingAdoption).toBe(false);
    });

    it('should return ADOPTED when completed adoption exists (highest priority)', async () => {
      // First call: completed adoption check
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce({ id: 'adoption-1' }) // completed adoption
        .mockResolvedValueOnce({ id: 'adoption-2' }); // pending adoption (ignored due to priority)
      mockPrismaService.custody.findFirst.mockResolvedValue({ id: 'custody-1' }); // active custody (ignored)

      const result = await service.resolve(petId);

      expect(result.status).toBe(PetStatus.ADOPTED);
      expect(result.hasCompletedAdoption).toBe(true);
    });

    it('should return IN_CUSTODY when active custody exists and no completed adoption', async () => {
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null) // no completed adoption
        .mockResolvedValueOnce(null); // no pending adoption (checked after custody)
      mockPrismaService.custody.findFirst.mockResolvedValue({ id: 'custody-1' });

      const result = await service.resolve(petId);

      expect(result.status).toBe(PetStatus.IN_CUSTODY);
      expect(result.hasActiveCustody).toBe(true);
      expect(result.hasCompletedAdoption).toBe(false);
    });

    it('should return PENDING when pending adoption exists and no completed adoption or active custody', async () => {
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null) // no completed adoption
        .mockResolvedValueOnce({ id: 'adoption-1' }); // pending adoption
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve(petId);

      expect(result.status).toBe(PetStatus.PENDING);
      expect(result.hasPendingAdoption).toBe(true);
    });

    it('should log state change when logStateChange is true', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockPrismaService.eventLog.create.mockResolvedValue({});

      await service.resolve(petId, true);

      expect(mockPrismaService.eventLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'PET',
          entityId: petId,
          payload: expect.objectContaining({
            computedStatus: PetStatus.AVAILABLE,
          }),
        }),
      });
    });

    it('should not log state change when logStateChange is false', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      await service.resolve(petId, false);

      expect(mockPrismaService.eventLog.create).not.toHaveBeenCalled();
    });
  });

  describe('getPetAvailability', () => {
    const petId = 'test-pet-id';

    it('should return true for AVAILABLE status', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(true);
    });

    it('should return true for PENDING status (still available until approved)', async () => {
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null) // no completed adoption
        .mockResolvedValueOnce({ id: 'pending-adoption' }); // pending adoption
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(true);
    });

    it('should return false for ADOPTED status', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValueOnce({ id: 'completed-adoption' });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });

    it('should return false for IN_CUSTODY status', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue({ id: 'active-custody' });

      const result = await service.getPetAvailability(petId);

      expect(result).toBe(false);
    });
  });

  describe('getPetStatus', () => {
    const petId = 'test-pet-id';

    it('should return the resolved PetStatus enum', async () => {
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetStatus(petId);

      expect(result).toBe(PetStatus.AVAILABLE);
    });
  });

  describe('resolveBatch', () => {
    it('should resolve availability for multiple pets efficiently', async () => {
      const petIds = ['pet-1', 'pet-2', 'pet-3'];

      mockPrismaService.adoption.findMany.mockResolvedValue([
        { petId: 'pet-1', status: AdoptionStatus.COMPLETED },
        { petId: 'pet-2', status: AdoptionStatus.REQUESTED },
      ]);
      mockPrismaService.custody.findMany.mockResolvedValue([
        { petId: 'pet-3', status: CustodyStatus.ACTIVE },
      ]);

      const results = await service.resolveBatch(petIds);

      expect(results.get('pet-1')?.status).toBe(PetStatus.ADOPTED);
      expect(results.get('pet-2')?.status).toBe(PetStatus.PENDING);
      expect(results.get('pet-3')?.status).toBe(PetStatus.IN_CUSTODY);
    });

    it('should handle empty pet ids array', async () => {
      mockPrismaService.adoption.findMany.mockResolvedValue([]);
      mockPrismaService.custody.findMany.mockResolvedValue([]);

      const results = await service.resolveBatch([]);

      expect(results.size).toBe(0);
    });

    it('should return AVAILABLE for pets with no records', async () => {
      mockPrismaService.adoption.findMany.mockResolvedValue([]);
      mockPrismaService.custody.findMany.mockResolvedValue([]);

      const results = await service.resolveBatch(['pet-1']);

      expect(results.get('pet-1')?.status).toBe(PetStatus.AVAILABLE);
    });
  });

  describe('priority rules', () => {
    const petId = 'test-pet-id';

    it('should prioritize ADOPTED over IN_CUSTODY', async () => {
      // Both completed adoption and active custody exist
      mockPrismaService.adoption.findFirst.mockResolvedValueOnce({ id: 'completed' });
      mockPrismaService.custody.findFirst.mockResolvedValue({ id: 'active-custody' });

      const result = await service.resolve(petId);

      expect(result.status).toBe(PetStatus.ADOPTED);
    });

    it('should prioritize IN_CUSTODY over PENDING', async () => {
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null) // no completed adoption
        .mockResolvedValueOnce({ id: 'pending' }); // pending adoption exists
      mockPrismaService.custody.findFirst.mockResolvedValue({ id: 'active-custody' });

      const result = await service.resolve(petId);

      expect(result.status).toBe(PetStatus.IN_CUSTODY);
    });
  });

  describe('detectAndLogStatusChange', () => {
    const petId = 'test-pet-id';

    it('logs a PET_AVAILABILITY_CHANGED event when the status flips', async () => {
      // resolve() call order: completed adoption, active custody, pending adoption
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'requested' });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      await service.detectAndLogStatusChange({
        petId,
        previousStatus: PetStatus.AVAILABLE,
        actorId: 'user-1',
        reason: 'ADOPTION_REQUESTED',
      });

      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      const args = prisma.eventLog.create.mock.calls[0][0];
      expect(args.data.entityType).toBe(EventEntityType.PET);
      expect(args.data.entityId).toBe(petId);
      expect(args.data.eventType).toBe(PET_AVAILABILITY_CHANGED);
      expect(args.data.payload).toMatchObject({
        petId,
        previousStatus: PetStatus.AVAILABLE,
        newStatus: PetStatus.PENDING,
        actorId: 'user-1',
        reason: 'ADOPTION_REQUESTED',
      });
    });

    it('does not log when the resolved status is unchanged', async () => {
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce({ id: 'completed' })
        .mockResolvedValueOnce(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);

      await service.detectAndLogStatusChange({
        petId,
        previousStatus: PetStatus.ADOPTED,
        reason: 'ADOPTION_COMPLETED',
      });

      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('propagates persistence failures to the caller', async () => {
      // Resolved status flips AVAILABLE -> PENDING, then logging fails.
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'requested' });
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      prisma.eventLog.create.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.detectAndLogStatusChange({
          petId,
          previousStatus: PetStatus.AVAILABLE,
          reason: 'CUSTODY_STARTED',
        }),
      ).rejects.toThrow('db down');
    });
  });
});
