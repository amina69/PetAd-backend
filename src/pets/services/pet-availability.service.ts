import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, CustodyStatus, Prisma } from '@prisma/client';
import { PetStatus } from '../../common/enums/pet-status.enum';
import { assertPetStatus, transitionPetStatus } from './pet-status-transition';

type PetStatusClient = Pick<Prisma.TransactionClient, 'pet'>;

/**
 * Computes pet availability dynamically from active adoption records,
 * active custody records, and ownership data.
 *
 * Priority rules:
 * 1. Adoption.status = COMPLETED → ADOPTED
 * 2. Custody.status = ACTIVE → IN_CUSTODY
 * 3. Adoption.status in (REQUESTED, PENDING, APPROVED, ESCROW_FUNDED) → PENDING
 * 4. Otherwise → AVAILABLE
 */
@Injectable()
export class PetAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    petId: string,
    nextStatus: PetStatus,
    client: PetStatusClient = this.prisma,
  ): Promise<PetStatus> {
    const pet = await client.pet.findUnique({
      where: { id: petId },
      select: { status: true },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with id "${petId}" not found`);
    }

    const status = transitionPetStatus(pet.status, nextStatus);
    await client.pet.update({
      where: { id: petId },
      data: { status },
    });

    return status;
  }

  async assertCurrentStatus(
    petId: string,
    expectedStatus: PetStatus,
    client: PetStatusClient = this.prisma,
  ): Promise<void> {
    const pet = await client.pet.findUnique({
      where: { id: petId },
      select: { status: true },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with id "${petId}" not found`);
    }

    assertPetStatus(pet.status, expectedStatus);
  }

  /**
   * Resolves the computed availability status for a pet.
   *
   * This method queries the latest adoption and active custody records
   * and applies priority rules to determine the pet's current status.
   *
   * Priority order (highest to lowest):
   *   ADOPTED overrides custody, custody overrides pending, pending overrides available.
   */
  async resolve(petId: string): Promise<PetStatus> {
    // 1. Check for completed adoption (highest priority)
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

    // 2. Check for active custody (second priority)
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

    // 3. Check for pending adoption (third priority)
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

    // 4. Default: AVAILABLE
    return PetStatus.AVAILABLE;
  }

  /**
   * Legacy boolean availability check.
   * Returns true if the pet has no blocking adoption or active custody.
   *
   * @deprecated Use resolve() instead for full PetStatus computation.
   */
  async getPetAvailability(petId: string): Promise<boolean> {
    const status = await this.resolve(petId);
    return status === PetStatus.AVAILABLE;
  }
}
