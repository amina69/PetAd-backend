import { PetStatus } from '../../common/enums/pet-status.enum';
import {
  assertPetStatus,
  transitionPetStatus,
} from '../../pets/services/pet-status-transition';

/**
 * The initial/default pet availability before any events are applied.
 */
const DEFAULT_AVAILABILITY = PetStatus.AVAILABLE;

/**
 * Replays an array of pet events to compute the current availability status.
 *
 * Lifecycle events are applied through the same transition table used by
 * write paths, so replay rejects histories containing impossible transitions.
 *
 * @param events - Array of event-like objects with `eventType` and optional `payload`
 * @returns The computed {@link PetStatus}
 */
export function petAvailabilityReducer(
  events: { eventType: string; payload?: unknown }[],
): PetStatus {
  let currentStatus: PetStatus = DEFAULT_AVAILABILITY;

  for (const event of events) {
    let nextStatus: PetStatus | undefined;

    switch (event.eventType) {
      case 'PET_LISTED':
        nextStatus = PetStatus.AVAILABLE;
        break;

      case 'ADOPTION_REQUESTED':
      case 'PET_ADOPTION_REQUESTED':
        nextStatus = PetStatus.PENDING;
        break;

      case 'ADOPTION_APPROVED':
      case 'PET_ADOPTION_APPROVED':
        assertPetStatus(currentStatus, PetStatus.PENDING);
        break;

      case 'ADOPTION_REJECTED':
      case 'ADOPTION_CANCELLED':
        nextStatus = PetStatus.AVAILABLE;
        break;

      case 'ADOPTION_COMPLETED':
      case 'PET_ADOPTED':
        nextStatus = PetStatus.ADOPTED;
        break;

      case 'CUSTODY_STARTED':
      case 'PET_CUSTODY_ACTIVE':
        nextStatus = PetStatus.IN_CUSTODY;
        break;

      case 'CUSTODY_RETURNED':
      case 'CUSTODY_COMPLETED':
      case 'PET_RETURNED':
      case 'PET_CUSTODY_CANCELLED':
      case 'CUSTODY_VIOLATION':
      case 'CUSTODY_CANCELLED':
        if (currentStatus === PetStatus.IN_CUSTODY) {
          nextStatus = PetStatus.AVAILABLE;
        }
        break;

      default:
        break;
    }

    if (nextStatus !== undefined && nextStatus !== currentStatus) {
      currentStatus = transitionPetStatus(currentStatus, nextStatus);
    }
  }

  return currentStatus;
}
