import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../auth/enums/role.enum';
import { AdoptionStatus, EscrowStatus } from '@prisma/client';

describe('ShelterAnalyticsService', () => {
  let service: ShelterAnalyticsService;
  let prisma: {
    user: { findUnique: jest.Mock; findMany: jest.Mock };
    pet: { count: jest.Mock };
    adoption: { findMany: jest.Mock; count: jest.Mock };
    custody: { count: jest.Mock };
    escrow: { findMany: jest.Mock };
  };

  const shelterUser = {
    userId: 'shelter-1',
    email: 'shelter1@pet.ad',
    role: Role.SHELTER,
  };

  const otherShelterUser = {
    userId: 'shelter-2',
    email: 'shelter2@pet.ad',
    role: Role.SHELTER,
  };

  const adminUser = {
    userId: 'admin-1',
    email: 'admin@pet.ad',
    role: Role.ADMIN,
  };

  const mockShelterDbRecord = {
    id: 'shelter-1',
    role: 'SHELTER',
    status: 'ACTIVE',
    trustScore: 85,
    deletedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockShelterDbRecord),
        findMany: jest.fn().mockResolvedValue([mockShelterDbRecord]),
      },
      pet: {
        count: jest.fn().mockResolvedValue(10),
      },
      adoption: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      custody: {
        count: jest.fn().mockResolvedValue(0),
      },
      escrow: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShelterAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ShelterAnalyticsService>(ShelterAnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Acceptance Criteria: Authorization & Cross-Shelter Access', () => {
    it("should throw NotFoundException (404) when a shelter queries another shelter's metrics", async () => {
      // shelter-2 attempts to query shelter-1
      await expect(
        service.getShelterMetrics('shelter-1', otherShelterUser),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getShelterMetrics('shelter-1', otherShelterUser),
      ).rejects.toThrow('Shelter metrics not found');
    });

    it('should throw NotFoundException (404) when the requested shelter does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getShelterMetrics('non-existent', adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException (404) when user is not a SHELTER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-regular',
        role: 'USER',
        status: 'ACTIVE',
      });

      await expect(
        service.getShelterMetrics('user-regular', adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow a shelter to query their own metrics', async () => {
      const result = await service.getShelterMetrics('shelter-1', shelterUser);
      expect(result).toBeDefined();
      expect(result.shelterId).toBe('shelter-1');
      // Shelters do not receive admin platform comparison
      expect(result.comparison).toBeUndefined();
    });

    it('should allow admins to query any shelter and receive platform median comparison', async () => {
      const result = await service.getShelterMetrics('shelter-1', adminUser);
      expect(result).toBeDefined();
      expect(result.shelterId).toBe('shelter-1');
      expect(result.comparison).toBeDefined();
      expect(result.comparison?.platformMedian).toBeDefined();
    });
  });

  describe('Acceptance Criteria: Small-sample Suppression', () => {
    it('should suppress metrics when case counts are fewer than N (default 5)', async () => {
      // 2 completed adoptions (< 5)
      prisma.adoption.findMany.mockImplementation(
        (args?: { where?: { status?: unknown } }) => {
          if (args?.where?.status === AdoptionStatus.COMPLETED) {
            return Promise.resolve([
              {
                createdAt: new Date('2026-11-01T00:00:00.000Z'),
                updatedAt: new Date('2026-11-10T00:00:00.000Z'),
                pet: { createdAt: new Date('2026-11-01T00:00:00.000Z') },
              },
              {
                createdAt: new Date('2026-11-02T00:00:00.000Z'),
                updatedAt: new Date('2026-11-08T00:00:00.000Z'),
                pet: { createdAt: new Date('2026-11-02T00:00:00.000Z') },
              },
            ]);
          }
          // 3 reviewed requests (< 5)
          return Promise.resolve([
            {
              createdAt: new Date('2026-11-01T00:00:00.000Z'),
              updatedAt: new Date('2026-11-01T04:00:00.000Z'),
            },
          ]);
        },
      );

      // 1 escrow (< 5)
      prisma.escrow.findMany.mockResolvedValue([
        { status: EscrowStatus.FUNDED },
      ]);

      // 2 agreements (< 5)
      prisma.adoption.count.mockResolvedValue(2);
      prisma.custody.count.mockResolvedValue(0);

      const result = await service.getShelterMetrics('shelter-1', shelterUser);

      // Verify suppression flags
      expect(result.suppressed.timeToAdoption).toBe(true);
      expect(result.suppressed.approvalResponseTime).toBe(true);
      expect(result.suppressed.disputeRate).toBe(true);
      expect(result.suppressed.ratingSummary).toBe(true);

      // Verify metric values are null
      expect(result.timeToAdoption).toBeNull();
      expect(result.timeToAdoptionDays).toBeNull();
      expect(result.approvalResponseTime).toBeNull();
      expect(result.approvalResponseTimeHours).toBeNull();
      expect(result.disputeRate).toBeNull();
      expect(result.ratingSummary?.average).toBeNull();
      expect(result.ratingSummary?.count).toBe(2);

      // Listings count is not suppressed
      expect(result.listings).toBe(10);
    });

    it('should unsuppress and calculate metrics when cases >= N (5)', async () => {
      // 5 completed adoptions with 10 days each
      const fiveAdoptions = Array.from({ length: 5 }, (_, i) => ({
        createdAt: new Date(`2026-11-0${i + 1}T00:00:00.000Z`),
        updatedAt: new Date(`2026-11-1${i + 1}T00:00:00.000Z`), // 10 days later
        pet: { createdAt: new Date(`2026-11-0${i + 1}T00:00:00.000Z`) },
      }));

      // 5 reviewed requests with 6 hours each
      const fiveReviews = Array.from({ length: 5 }, (_, i) => ({
        createdAt: new Date(`2026-11-0${i + 1}T00:00:00.000Z`),
        updatedAt: new Date(`2026-11-0${i + 1}T06:00:00.000Z`), // 6 hours later
      }));

      prisma.adoption.findMany.mockImplementation(
        (args?: { where?: { status?: unknown } }) => {
          if (args?.where?.status === AdoptionStatus.COMPLETED) {
            return Promise.resolve(fiveAdoptions);
          }
          return Promise.resolve(fiveReviews);
        },
      );

      // 5 escrows with 1 disputed (disputeRate = 1/5 = 0.2)
      prisma.escrow.findMany.mockResolvedValue([
        { status: EscrowStatus.FUNDED },
        { status: EscrowStatus.FUNDED },
        { status: EscrowStatus.FUNDED },
        { status: EscrowStatus.RELEASED },
        { status: EscrowStatus.DISPUTED },
      ]);

      // 6 completed agreements
      prisma.adoption.count.mockResolvedValue(5);
      prisma.custody.count.mockResolvedValue(1);

      const result = await service.getShelterMetrics('shelter-1', shelterUser);

      // Verify suppression flags are false
      expect(result.suppressed.timeToAdoption).toBe(false);
      expect(result.suppressed.approvalResponseTime).toBe(false);
      expect(result.suppressed.disputeRate).toBe(false);
      expect(result.suppressed.ratingSummary).toBe(false);

      // Verify calculated values
      expect(result.timeToAdoption).toBe(10);
      expect(result.timeToAdoptionDays).toBe(10);
      expect(result.approvalResponseTime).toBe(6);
      expect(result.approvalResponseTimeHours).toBe(6);
      expect(result.disputeRate).toBe(0.2);
      expect(result.ratingSummary?.average).toBe(4.3); // 85 / 20 = 4.25 -> 4.3
      expect(result.ratingSummary?.count).toBe(6);
    });
  });
});
