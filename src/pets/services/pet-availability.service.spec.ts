import { Test, TestingModule } from '@nestjs/testing';
import {
  PetAvailabilityService,
  computePetStatus,
  PET_AVAILABILITY_CHANGED,
} from './pet-availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { AdoptionStatus, CustodyStatus, EventEntityType } from '@prisma/client';
import { PetStatus } from '../../common/enums/pet-status.enum';

describe('computePetStatus', () => {
  it('returns ADOPTED when latest adoption is COMPLETED', () => {
    expect(computePetStatus(AdoptionStatus.COMPLETED, false)).toBe(
      PetStatus.ADOPTED,
    );
  });

  it('returns ADOPTED even when there is an active custody (adopted overrides custody)', () => {
    expect(computePetStatus(AdoptionStatus.COMPLETED, true)).toBe(
      PetStatus.ADOPTED,
    );
  });

  it('returns IN_CUSTODY when active custody and no completed adoption', () => {
    expect(computePetStatus(null, true)).toBe(PetStatus.IN_CUSTODY);
  });

  it('returns IN_CUSTODY when custody active and latest adoption is REQUESTED (custody overrides pending)', () => {
    expect(computePetStatus(AdoptionStatus.REQUESTED, true)).toBe(
      PetStatus.IN_CUSTODY,
    );
  });

  it('returns IN_CUSTODY when custody active and latest adoption is PENDING', () => {
    expect(computePetStatus(AdoptionStatus.PENDING, true)).toBe(
      PetStatus.IN_CUSTODY,
    );
  });

  it('returns IN_CUSTODY when custody active and latest adoption is APPROVED', () => {
    expect(computePetStatus(AdoptionStatus.APPROVED, true)).toBe(
      PetStatus.IN_CUSTODY,
    );
  });

  it('returns IN_CUSTODY when custody active and latest adoption is ESCROW_FUNDED', () => {
    expect(computePetStatus(AdoptionStatus.ESCROW_FUNDED, true)).toBe(
      PetStatus.IN_CUSTODY,
    );
  });

  it('returns PENDING when latest adoption is REQUESTED and no active custody', () => {
    expect(computePetStatus(AdoptionStatus.REQUESTED, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns PENDING when latest adoption is PENDING and no active custody', () => {
    expect(computePetStatus(AdoptionStatus.PENDING, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns PENDING when latest adoption is APPROVED and no active custody', () => {
    expect(computePetStatus(AdoptionStatus.APPROVED, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns PENDING when latest adoption is ESCROW_FUNDED and no active custody', () => {
    expect(computePetStatus(AdoptionStatus.ESCROW_FUNDED, false)).toBe(
      PetStatus.PENDING,
    );
  });

  it('returns AVAILABLE when latest adoption is REJECTED (falls through)', () => {
    expect(computePetStatus(AdoptionStatus.REJECTED, false)).toBe(
      PetStatus.AVAILABLE,
    );
  });

  it('returns AVAILABLE when latest adoption is CANCELLED (falls through)', () => {
    expect(computePetStatus(AdoptionStatus.CANCELLED, false)).toBe(
      PetStatus.AVAILABLE,
    );
  });

  it('returns AVAILABLE when latest adoption is REJECTED with active custody', () => {
    expect(computePetStatus(AdoptionStatus.REJECTED, true)).toBe(
      PetStatus.IN_CUSTODY,
    );
  });

  it('returns AVAILABLE when no adoption and no custody', () => {
    expect(computePetStatus(null, false)).toBe(PetStatus.AVAILABLE);
  });

  it('returns AVAILABLE when no adoption and custody inactive', () => {
    expect(computePetStatus(null, false)).toBe(PetStatus.AVAILABLE);
  });
});

describe('PetAvailabilityService', () => {
  let service: PetAvailabilityService;

  const mockPrisma = {
    adoption: {
      findFirst: jest.fn(),
    },
    custody: {
      findFirst: jest.fn(),
    },
  };

  const mockEvents = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetAvailabilityService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<PetAvailabilityService>(PetAvailabilityService);
  });

  describe('resolve', () => {
    it('returns AVAILABLE when no adoption and no active custody', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.AVAILABLE);
      expect(mockPrisma.adoption.findFirst).toHaveBeenCalledWith({
        where: { petId: 'pet-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(mockPrisma.custody.findFirst).toHaveBeenCalledWith({
        where: { petId: 'pet-1', status: CustodyStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns ADOPTED when latest adoption is COMPLETED', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.COMPLETED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.ADOPTED);
    });

    it('returns ADOPTED when COMPLETED adoption overrides active custody', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.COMPLETED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
      });

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.ADOPTED);
    });

    it('returns IN_CUSTODY when active custody and no completed adoption', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
      });

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.IN_CUSTODY);
    });

    it('returns IN_CUSTODY when active custody overrides pending adoption', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.PENDING,
      });
      mockPrisma.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
      });

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.IN_CUSTODY);
    });

    it('returns PENDING when latest adoption is REQUESTED and no active custody', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REQUESTED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.PENDING);
    });

    it('returns PENDING when latest adoption is APPROVED and no active custody', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.APPROVED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.PENDING);
    });

    it('returns PENDING when latest adoption is ESCROW_FUNDED and no active custody', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.ESCROW_FUNDED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.PENDING);
    });

    it('returns AVAILABLE when latest adoption is REJECTED', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REJECTED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('returns AVAILABLE when latest adoption is CANCELLED', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.CANCELLED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.resolve('pet-1');

      expect(result).toBe(PetStatus.AVAILABLE);
    });

    it('queries adoption and custody in parallel', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      await service.resolve('pet-1');

      expect(mockPrisma.adoption.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.custody.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPetAvailability', () => {
    it('returns true when status is AVAILABLE', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability('pet-1');

      expect(result).toBe(true);
    });

    it('returns false when status is PENDING', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REQUESTED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability('pet-1');

      expect(result).toBe(false);
    });

    it('returns false when status is IN_CUSTODY', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue({
        id: 'custody-1',
        status: CustodyStatus.ACTIVE,
      });

      const result = await service.getPetAvailability('pet-1');

      expect(result).toBe(false);
    });

    it('returns false when status is ADOPTED', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.COMPLETED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      const result = await service.getPetAvailability('pet-1');

      expect(result).toBe(false);
    });
  });

  describe('detectAndLogStatusChange', () => {
    it('logs PET_AVAILABILITY_CHANGED when status differs from previous', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.REQUESTED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);
      mockEvents.logEvent.mockResolvedValue({});

      await service.detectAndLogStatusChange({
        petId: 'pet-1',
        previousStatus: PetStatus.AVAILABLE,
        actorId: 'user-1',
        reason: 'ADOPTION_REQUESTED',
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith({
        entityType: EventEntityType.PET,
        entityId: 'pet-1',
        eventType: PET_AVAILABILITY_CHANGED,
        actorId: 'user-1',
        payload: {
          petId: 'pet-1',
          previousStatus: PetStatus.AVAILABLE,
          newStatus: PetStatus.PENDING,
          reason: 'ADOPTION_REQUESTED',
        },
      });
    });

    it('does not log when status is unchanged', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue(null);
      mockPrisma.custody.findFirst.mockResolvedValue(null);

      await service.detectAndLogStatusChange({
        petId: 'pet-1',
        previousStatus: PetStatus.AVAILABLE,
        actorId: 'user-1',
        reason: 'CUSTODY_RETURNED',
      });

      expect(mockEvents.logEvent).not.toHaveBeenCalled();
    });

    it('propagates logEvent errors', async () => {
      mockPrisma.adoption.findFirst.mockResolvedValue({
        id: 'adoption-1',
        status: AdoptionStatus.COMPLETED,
      });
      mockPrisma.custody.findFirst.mockResolvedValue(null);
      mockEvents.logEvent.mockRejectedValue(new Error('DB write failed'));

      await expect(
        service.detectAndLogStatusChange({
          petId: 'pet-1',
          previousStatus: PetStatus.PENDING,
          actorId: 'user-1',
          reason: 'ADOPTION_COMPLETED',
        }),
      ).rejects.toThrow('DB write failed');
    });
  });
});
