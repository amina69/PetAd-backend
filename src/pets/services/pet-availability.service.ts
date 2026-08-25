import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdoptionStatus,
  CustodyStatus,
  EventType,
  EventEntityType,
} from '@prisma/client';
import { PetStatus } from '../../common/enums/pet-status.enum';

/** Adoption statuses that reserve a pet without finalizing the adoption. */
const PENDING_ADOPTION_STATUSES: readonly AdoptionStatus[] = [
  AdoptionStatus.REQUESTED,
  AdoptionStatus.PENDING,
  AdoptionStatus.APPROVED,
  AdoptionStatus.ESCROW_FUNDED,
];

/**
 * Availability-audit event type appended whenever a pet's computed status
 * flips. Deliberately NOT added to the generated Prisma `EventType` enum to
 * avoid a schema migration for a derived-state audit event; the
 * `petAvailabilityReducer` silently ignores unknown event types, so replay
 * verification remains unaffected.
 */
export const PET_AVAILABILITY_CHANGED = 'PET_AVAILABILITY_CHANGED' as EventType;

/**
 * Pure resolver mapping live adoption/custody data onto a {@link PetStatus}.
 * Never reads or writes storage — safe to unit test and reuse in-memory
 * (e.g. for paginated lists that already include relations).
 *
 * Priority rules (each level overrides everything below it):
 *  1. latest adoption COMPLETED                                → ADOPTED
 *  2. active custody                                           → IN_CUSTODY
 *  3. latest adoption REQUESTED|PENDING|APPROVED|ESCROW_FUNDED → PENDING
 *  4. otherwise                                                → AVAILABLE
 *
 * REJECTED/CANCELLED latest adoptions fall through to the rules below.
 */
export function computePetStatus(
  latestAdoptionStatus: AdoptionStatus | null,
  hasActiveCustody: boolean,
): PetStatus {
  if (latestAdoptionStatus === AdoptionStatus.COMPLETED) {
    return PetStatus.ADOPTED;
  }

  if (hasActiveCustody) {
    return PetStatus.IN_CUSTODY;
  }

  if (
    latestAdoptionStatus !== null &&
    PENDING_ADOPTION_STATUSES.includes(latestAdoptionStatus)
  ) {
    return PetStatus.PENDING;
  }

  return PetStatus.AVAILABLE;
}

/**
 * Computed state result from resolving pet availability
 */
export interface PetAvailabilityResult {
  petId: string;
  status: PetStatus;
  previousStatus?: PetStatus;
  hasCompletedAdoption: boolean;
  hasActiveCustody: boolean;
  hasPendingAdoption: boolean;
}

@Injectable()
export class PetAvailabilityService {
  private readonly logger = new Logger(PetAvailabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve pet availability status dynamically from related records.
   * Priority order:
   * 1. Completed adoption → ADOPTED
   * 2. Active custody → IN_CUSTODY
   * 3. Pending adoption states → PENDING
   * 4. All other cases → AVAILABLE
   *
   * @param petId - The pet ID to resolve availability for
   * @param logStateChange - Whether to create an EventLog on state change
   * @returns PetAvailabilityResult with computed status
   */
  async resolve(petId: string, logStateChange = false): Promise<PetAvailabilityResult> {
    // Query for completed adoption (highest priority)
    const completedAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: AdoptionStatus.COMPLETED,
      },
      select: { id: true },
    });

    // Query for active custody
    const activeCustody = await this.prisma.custody.findFirst({
      where: {
        petId,
        status: CustodyStatus.ACTIVE,
      },
      select: { id: true },
    });

    // Query for pending adoption states (not rejected/cancelled/completed)
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

    // Apply priority-based rules
    let status: PetStatus;
    if (completedAdoption) {
      status = PetStatus.ADOPTED;
    } else if (activeCustody) {
      status = PetStatus.IN_CUSTODY;
    } else if (pendingAdoption) {
      status = PetStatus.PENDING;
    } else {
      status = PetStatus.AVAILABLE;
    }

    const result: PetAvailabilityResult = {
      petId,
      status,
      hasCompletedAdoption: !!completedAdoption,
      hasActiveCustody: !!activeCustody,
      hasPendingAdoption: !!pendingAdoption,
    };

    // Log state change if requested
    if (logStateChange) {
      await this.logStateChange(petId, status);
    }

    return result;
  }

  /**
   * Get pet availability as a boolean (backwards compatible)
   */
  async getPetAvailability(petId: string): Promise<boolean> {
    const result = await this.resolve(petId);
    return result.status === PetStatus.AVAILABLE || result.status === PetStatus.PENDING;
  }

  /**
   * Get pet availability status enum
   */
  async getPetStatus(petId: string): Promise<PetStatus> {
    const result = await this.resolve(petId);
    return result.status;
  }

  /**
   * Batch resolve availability for multiple pets
   */
  async resolveBatch(petIds: string[]): Promise<Map<string, PetAvailabilityResult>> {
    const results = new Map<string, PetAvailabilityResult>();

    // Query all adoptions for these pets
    const adoptions = await this.prisma.adoption.findMany({
      where: { petId: { in: petIds } },
      select: { petId: true, status: true },
    });

    // Query all custodies for these pets
    const custodies = await this.prisma.custody.findMany({
      where: { petId: { in: petIds } },
      select: { petId: true, status: true },
    });

    // Group by petId
    const adoptionsByPet = new Map<string, typeof adoptions>();
    for (const adoption of adoptions) {
      const existing = adoptionsByPet.get(adoption.petId) || [];
      existing.push(adoption);
      adoptionsByPet.set(adoption.petId, existing);
    }

    const custodiesByPet = new Map<string, typeof custodies>();
    for (const custody of custodies) {
      const existing = custodiesByPet.get(custody.petId) || [];
      existing.push(custody);
      custodiesByPet.set(custody.petId, existing);
    }

    // Resolve each pet
    for (const petId of petIds) {
      const petAdoptions = adoptionsByPet.get(petId) || [];
      const petCustodies = custodiesByPet.get(petId) || [];

      const hasCompletedAdoption = petAdoptions.some(
        (a) => a.status === AdoptionStatus.COMPLETED,
      );
      const hasActiveCustody = petCustodies.some(
        (c) => c.status === CustodyStatus.ACTIVE,
      );
      const hasPendingAdoption = petAdoptions.some((a) =>
        [
          AdoptionStatus.REQUESTED,
          AdoptionStatus.PENDING,
          AdoptionStatus.APPROVED,
          AdoptionStatus.ESCROW_FUNDED,
        ].includes(a.status),
      );

      let status: PetStatus;
      if (hasCompletedAdoption) {
        status = PetStatus.ADOPTED;
      } else if (hasActiveCustody) {
        status = PetStatus.IN_CUSTODY;
      } else if (hasPendingAdoption) {
        status = PetStatus.PENDING;
      } else {
        status = PetStatus.AVAILABLE;
      }

      results.set(petId, {
        petId,
        status,
        hasCompletedAdoption,
        hasActiveCustody,
        hasPendingAdoption,
      });
    }

    return results;
  }

  /**
   * Log state change to EventLog
   */
  private async logStateChange(petId: string, newStatus: PetStatus): Promise<void> {
    const eventTypeMap: Record<PetStatus, EventType> = {
      [PetStatus.AVAILABLE]: EventType.PET_LISTED,
      [PetStatus.PENDING]: EventType.ADOPTION_REQUESTED,
      [PetStatus.IN_CUSTODY]: EventType.PET_CUSTODY_ACTIVE,
      [PetStatus.ADOPTED]: EventType.PET_ADOPTED,
    };

    try {
      await this.prisma.eventLog.create({
        data: {
          entityType: EventEntityType.PET,
          entityId: petId,
          eventType: eventTypeMap[newStatus],
          payload: {
            computedStatus: newStatus,
            timestamp: new Date().toISOString(),
          },
        },
      });
      this.logger.log(`State change logged for pet ${petId}: ${newStatus}`);
    } catch (error) {
      this.logger.error(`Failed to log state change for pet ${petId}`, error);
    }
  }

  /**
   * Resolves the current computed status and appends a
   * PET_AVAILABILITY_CHANGED audit event when it differs from
   * `previousStatus`. No-op when the status is unchanged.
   *
   * Unlike {@link logStateChange}, failures propagate to the caller so that
   * mutation sites (adoption/custody services) behave consistently with
   * their existing `logEvent` convention.
   */
  async detectAndLogStatusChange(params: {
    petId: string;
    previousStatus: PetStatus;
    actorId?: string;
    reason: string;
  }): Promise<void> {
    const newStatus = await this.getPetStatus(params.petId);

    if (newStatus === params.previousStatus) return;

    await this.prisma.eventLog.create({
      data: {
        entityType: EventEntityType.PET,
        entityId: params.petId,
        eventType: PET_AVAILABILITY_CHANGED,
        payload: {
          petId: params.petId,
          previousStatus: params.previousStatus,
          newStatus,
          ...(params.actorId !== undefined && { actorId: params.actorId }),
          reason: params.reason,
        },
      },
    });
  }
}
