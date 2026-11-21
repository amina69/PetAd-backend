import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdoptionStatus, EscrowStatus } from '@prisma/client';
import {
  PlatformMedianMetricsDto,
  ShelterAnalyticsResponseDto,
} from './dto/shelter-analytics-response.dto';

export const DEFAULT_MIN_SAMPLE_SIZE = 5;

@Injectable()
export class ShelterAnalyticsService {
  private readonly logger = new Logger(ShelterAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  /**
   * GET /shelters/:id/analytics
   *
   * Computes shelter performance metrics:
   * - listings: count of pet listings
   * - time-to-adoption: duration from listing to adoption completion
   * - approval response time: duration from adoption request to review
   * - dispute rate: disputed escrows / total escrows
   * - rating summary: average and agreement count
   *
   * Permissions:
   * - A shelter can ONLY query their own metrics. Attempting to query another shelter returns 404.
   * - Admins see all shelters and receive a comparison against the platform median.
   *
   * Small-sample suppression:
   * - Metrics with fewer than minSampleSize cases (default 5) are suppressed (set to null).
   */
  async getShelterMetrics(
    shelterId: string,
    currentUser: CurrentUserPayload,
    minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE,
  ): Promise<ShelterAnalyticsResponseDto> {
    const userRole = currentUser.role;
    const reqUser = currentUser as unknown as { userId?: string; sub?: string };
    const requesterId = reqUser.userId ?? reqUser.sub;

    // Acceptance criteria: A shelter can't query another shelter's metrics (404)
    if ((userRole as Role) === Role.SHELTER && requesterId !== shelterId) {
      throw new NotFoundException('Shelter metrics not found');
    }

    // Verify shelter exists and has SHELTER role
    const shelter = await this.prisma.user.findUnique({
      where: { id: shelterId },
      select: {
        id: true,
        role: true,
        status: true,
        trustScore: true,
        deletedAt: true,
      },
    });

    if (
      !shelter ||
      shelter.role !== 'SHELTER' ||
      shelter.status === 'DELETED' ||
      shelter.deletedAt
    ) {
      throw new NotFoundException('Shelter not found');
    }

    // 1. Listings count
    const listingsCount = await this.prisma.pet.count({
      where: { currentOwnerId: shelterId },
    });

    // 2. Time-to-adoption (completed adoptions)
    const completedAdoptions = await this.prisma.adoption.findMany({
      where: {
        ownerId: shelterId,
        status: AdoptionStatus.COMPLETED,
      },
      select: {
        createdAt: true,
        updatedAt: true,
        pet: {
          select: {
            createdAt: true,
          },
        },
      },
    });

    const adoptionDurationsDays = completedAdoptions
      .map((a) => {
        const start = a.pet?.createdAt ?? a.createdAt;
        const diffMs = a.updatedAt.getTime() - start.getTime();
        return diffMs >= 0 ? diffMs / (1000 * 60 * 60 * 24) : 0;
      })
      .filter((d) => !isNaN(d));

    // 3. Approval response time (adoptions reviewed / responded to)
    const reviewedRequests = await this.prisma.adoption.findMany({
      where: {
        ownerId: shelterId,
        status: { not: AdoptionStatus.REQUESTED },
      },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });

    const approvalDurationsHours = reviewedRequests
      .map((r) => {
        const diffMs = r.updatedAt.getTime() - r.createdAt.getTime();
        return diffMs >= 0 ? diffMs / (1000 * 60 * 60) : 0;
      })
      .filter((h) => !isNaN(h));

    // 4. Dispute rate (escrows associated with shelter's adoptions)
    const escrows = await this.prisma.escrow.findMany({
      where: {
        adoption: {
          ownerId: shelterId,
        },
      },
      select: {
        status: true,
      },
    });

    const totalEscrowsCount = escrows.length;
    const disputedEscrowsCount = escrows.filter(
      (e) => e.status === EscrowStatus.DISPUTED,
    ).length;

    // 5. Rating summary
    const [adoptionsCount, custodiesCount] = await Promise.all([
      this.prisma.adoption.count({
        where: {
          status: AdoptionStatus.COMPLETED,
          OR: [{ adopterId: shelterId }, { ownerId: shelterId }],
        },
      }),
      this.prisma.custody.count({
        where: {
          status: 'COMPLETED',
          holderId: shelterId,
        },
      }),
    ]);
    const agreementsCount = adoptionsCount + custodiesCount;

    // Small-sample suppression checks (< minSampleSize)
    const timeToAdoptionSuppressed =
      adoptionDurationsDays.length < minSampleSize;
    const approvalSuppressed = approvalDurationsHours.length < minSampleSize;
    const disputeRateSuppressed = totalEscrowsCount < minSampleSize;
    const ratingSummarySuppressed = agreementsCount < minSampleSize;

    const timeToAdoption = timeToAdoptionSuppressed
      ? null
      : Number(
          (
            adoptionDurationsDays.reduce((a, b) => a + b, 0) /
            adoptionDurationsDays.length
          ).toFixed(1),
        );

    const approvalResponseTime = approvalSuppressed
      ? null
      : Number(
          (
            approvalDurationsHours.reduce((a, b) => a + b, 0) /
            approvalDurationsHours.length
          ).toFixed(1),
        );

    const disputeRate = disputeRateSuppressed
      ? null
      : totalEscrowsCount > 0
        ? Number((disputedEscrowsCount / totalEscrowsCount).toFixed(4))
        : 0;

    const ratingAverage = shelter.trustScore
      ? Number((shelter.trustScore / 20).toFixed(1))
      : 0;

    const ratingSummary = ratingSummarySuppressed
      ? { average: null, count: agreementsCount }
      : { average: ratingAverage, count: agreementsCount };

    const result: ShelterAnalyticsResponseDto = {
      shelterId,
      listings: listingsCount,
      timeToAdoption,
      timeToAdoptionDays: timeToAdoption,
      approvalResponseTime,
      approvalResponseTimeHours: approvalResponseTime,
      disputeRate,
      ratingSummary,
      sampleSizes: {
        listings: listingsCount,
        completedAdoptions: adoptionDurationsDays.length,
        reviewedRequests: approvalDurationsHours.length,
        escrows: totalEscrowsCount,
        ratings: agreementsCount,
      },
      suppressed: {
        timeToAdoption: timeToAdoptionSuppressed,
        approvalResponseTime: approvalSuppressed,
        disputeRate: disputeRateSuppressed,
        ratingSummary: ratingSummarySuppressed,
      },
    };

    // Admins and analysts see platform median comparison
    if (
      (userRole as Role) === Role.ADMIN ||
      (userRole as Role) === Role.ANALYST
    ) {
      result.comparison = {
        platformMedian: await this.computePlatformMedian(),
      };
    }

    return result;
  }

  /**
   * Computes the platform median for each performance metric across all active shelters.
   */
  private async computePlatformMedian(): Promise<PlatformMedianMetricsDto> {
    try {
      const allShelters = await this.prisma.user.findMany({
        where: {
          role: 'SHELTER',
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true, trustScore: true },
      });

      if (allShelters.length === 0) {
        return {
          timeToAdoptionDays: null,
          approvalResponseTimeHours: null,
          disputeRate: null,
          ratingAverage: null,
        };
      }

      // 1. Completed adoptions across all shelters
      const completedAdoptions = await this.prisma.adoption.findMany({
        where: {
          status: AdoptionStatus.COMPLETED,
        },
        select: {
          createdAt: true,
          updatedAt: true,
          pet: { select: { createdAt: true } },
        },
      });

      const allAdoptionDurationsDays = completedAdoptions
        .map((a) => {
          const start = a.pet?.createdAt ?? a.createdAt;
          const diffMs = a.updatedAt.getTime() - start.getTime();
          return diffMs >= 0 ? diffMs / (1000 * 60 * 60 * 24) : 0;
        })
        .filter((d) => !isNaN(d));

      // 2. Reviewed requests across platform
      const reviewed = await this.prisma.adoption.findMany({
        where: {
          status: { not: AdoptionStatus.REQUESTED },
        },
        select: { createdAt: true, updatedAt: true },
      });

      const allApprovalDurationsHours = reviewed
        .map((r) => {
          const diffMs = r.updatedAt.getTime() - r.createdAt.getTime();
          return diffMs >= 0 ? diffMs / (1000 * 60 * 60) : 0;
        })
        .filter((h) => !isNaN(h));

      // 3. Dispute rates per shelter with escrows
      const escrows = await this.prisma.escrow.findMany({
        select: { status: true, adoption: { select: { ownerId: true } } },
      });

      const shelterEscrowCounts: Record<
        string,
        { total: number; disputed: number }
      > = {};
      for (const e of escrows) {
        const ownerId = e.adoption?.ownerId;
        if (ownerId) {
          if (!shelterEscrowCounts[ownerId]) {
            shelterEscrowCounts[ownerId] = { total: 0, disputed: 0 };
          }
          shelterEscrowCounts[ownerId].total += 1;
          if (e.status === EscrowStatus.DISPUTED) {
            shelterEscrowCounts[ownerId].disputed += 1;
          }
        }
      }

      const allDisputeRates = Object.values(shelterEscrowCounts)
        .filter((c) => c.total > 0)
        .map((c) => c.disputed / c.total);

      // 4. Rating averages
      const allRatingAverages = allShelters
        .map((s) => (s.trustScore ? s.trustScore / 20 : 0))
        .filter((r) => r > 0);

      return {
        timeToAdoptionDays: this.calculateMedian(allAdoptionDurationsDays),
        approvalResponseTimeHours: this.calculateMedian(
          allApprovalDurationsHours,
        ),
        disputeRate: this.calculateMedian(allDisputeRates),
        ratingAverage: this.calculateMedian(allRatingAverages),
      };
    } catch (err: unknown) {
      this.logger.error(
        `Error computing platform median: ${this.getErrorMessage(err)}`,
      );
      return {
        timeToAdoptionDays: null,
        approvalResponseTimeHours: null,
        disputeRate: null,
        ratingAverage: null,
      };
    }
  }

  private calculateMedian(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return Number(sorted[mid].toFixed(2));
    }
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }
}
