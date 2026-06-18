import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, CustodyStatus } from '@prisma/client';
import { PetStatus } from '../../common/enums/pet-status.enum';

/**
 * Computes the availability state of a pet dynamically from adoption and custody records.
 *
 * Priority order (highest → lowest):
 *   1. ADOPTED      — any adoption with status COMPLETED
 *   2. IN_CUSTODY   — any custody with status ACTIVE
 *   3. PENDING      — any adoption with status REQUESTED | PENDING | APPROVED | ESCROW_FUNDED
 *   4. AVAILABLE    — none of the above
 *
 * No status is stored on the Pet model; this is always derived at query time.
 */
@Injectable()
export class PetAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(petId: string): Promise<PetStatus> {
    // 1. Check for a completed adoption → ADOPTED
    const completedAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: AdoptionStatus.COMPLETED,
      },
      select: { id: true },
    });

    if (completedAdoption) {
      return PetStatus.ADOPTED;
    }

    // 2. Check for an active custody → IN_CUSTODY
    const activeCustody = await this.prisma.custody.findFirst({
      where: {
        petId,
        status: CustodyStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (activeCustody) {
      return PetStatus.IN_CUSTODY;
    }

    // 3. Check for an in-progress adoption → PENDING
    const pendingAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: {
          in: [
            AdoptionStatus.REQUESTED,
            AdoptionStatus.PENDING,
            AdoptionStatus.APPROVED,
            AdoptionStatus.ESCROW_FUNDED,
          ],
        },
      },
      select: { id: true },
    });

    if (pendingAdoption) {
      return PetStatus.PENDING;
    }

    // 4. No blocking records → AVAILABLE
    return PetStatus.AVAILABLE;
  }

  /**
   * @deprecated Use `resolve(petId)` instead, which returns a rich PetStatus.
   * Kept for backward compatibility during migration.
   */
  async getPetAvailability(petId: string): Promise<boolean> {
    const status = await this.resolve(petId);
    return status === PetStatus.AVAILABLE;
  }
}
