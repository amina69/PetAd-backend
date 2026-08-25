import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdoptionStatus,
  CustodyStatus,
  EventEntityType,
  EventType,
  Prisma,
} from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { PetStatus } from '../../common/enums/pet-status.enum';

/**
 * Availability-audit event type appended whenever a pet's computed status flips.
 *
 * Deliberately NOT added to the generated Prisma `EventType` enum to avoid a
 * schema migration for a derived-state audit event. The cast follows the
 * existing convention in `EventsService.appendEvent` for out-of-enum event
 * types, and unknown event types are silently ignored by
 * `petAvailabilityReducer`, so replay verification remains unaffected.
 */
export const PET_AVAILABILITY_CHANGED = 'PET_AVAILABILITY_CHANGED' as EventType;

/** Adoption statuses that reserve a pet without finalizing the adoption. */
const PENDING_ADOPTION_STATUSES: readonly AdoptionStatus[] = [
  AdoptionStatus.REQUESTED,
  AdoptionStatus.PENDING,
  AdoptionStatus.APPROVED,
  AdoptionStatus.ESCROW_FUNDED,
];

/**
 * Pure resolver mapping live adoption/custody data onto a {@link PetStatus}.
 * Never reads or writes storage — safe to unit test and reuse in-memory.
 *
 * Priority rules (each level overrides everything below it):
 *  1. latest adoption COMPLETED                          → ADOPTED (overrides custody)
 *  2. active custody                                     → IN_CUSTODY (overrides pending)
 *  3. latest adoption REQUESTED|PENDING|APPROVED|ESCROW_FUNDED → PENDING (overrides available)
 *  4. otherwise                                          → AVAILABLE
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

/** Parameters for {@link PetAvailabilityService.detectAndLogStatusChange}. */
export interface PetAvailabilityChangeParams {
  petId: string;
  previousStatus: PetStatus;
  actorId?: string;
  reason: string;
}

@Injectable()
export class PetAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Computes a pet's status from live adoption/custody data.
   * The status is never stored on the Pet record — it is always derived.
   */
  async resolve(petId: string): Promise<PetStatus> {
    const [latestAdoption, activeCustody] = await Promise.all([
      this.prisma.adoption.findFirst({
        where: { petId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.custody.findFirst({
        where: { petId, status: CustodyStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return computePetStatus(
      latestAdoption?.status ?? null,
      activeCustody !== null,
    );
  }

  /**
   * Backward-compatible boolean view of {@link resolve}. Kept because existing
   * callers (e.g. verifyAvailability) rely on the boolean contract.
   */
  async getPetAvailability(petId: string): Promise<boolean> {
    return (await this.resolve(petId)) === PetStatus.AVAILABLE;
  }

  /**
   * Resolves the current status and logs a PET_AVAILABILITY_CHANGED event on
   * the PET aggregate when it differs from `previousStatus`. Logging failures
   * propagate to the caller (repo convention — see AdoptionService).
   */
  async detectAndLogStatusChange(
    params: PetAvailabilityChangeParams,
  ): Promise<void> {
    const newStatus = await this.resolve(params.petId);
    if (newStatus === params.previousStatus) return;

    await this.events.logEvent({
      entityType: EventEntityType.PET,
      entityId: params.petId,
      eventType: PET_AVAILABILITY_CHANGED,
      actorId: params.actorId,
      payload: {
        petId: params.petId,
        previousStatus: params.previousStatus,
        newStatus,
        reason: params.reason,
      } satisfies Prisma.InputJsonValue,
    });
  }
}
