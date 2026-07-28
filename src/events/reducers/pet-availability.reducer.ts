import { PetStatus } from '../../common/enums/pet-status.enum';

/**
 * The initial/default pet availability before any events are applied.
 */
const DEFAULT_AVAILABILITY = PetStatus.AVAILABLE;

/**
 * Replays an array of pet events to compute the current availability status.
 *
 * Availability rules from events:
 * - PET_LISTED             → AVAILABLE
 * - ADOPTION_REQUESTED or PET_ADOPTION_REQUESTED → PENDING (still available until approved)
 * - ADOPTION_APPROVED  or PET_ADOPTION_APPROVED  → reserved (PENDING, not yet adopted)
 * - PET_ADOPTED            → ADOPTED (permanently not available)
 * - CUSTODY_STARTED  or PET_CUSTODY_ACTIVE       → IN_CUSTODY (temporarily unavailable)
 * - CUSTODY_RETURNED  or PET_RETURNED            → AVAILABLE again
 *
 * The reducer processes events in chronological order; the last
 * availability-determining event wins.
 *
 * @param events - Array of event-like objects with `eventType` and optional `payload`
 * @returns The computed {@link PetStatus}
 */
export function petAvailabilityReducer(
  events: { eventType: string; payload?: Record<string, unknown> }[],
): PetStatus {
  let currentStatus: PetStatus = DEFAULT_AVAILABILITY;

  for (const event of events) {
    switch (event.eventType) {
      case 'PET_LISTED':
        currentStatus = PetStatus.AVAILABLE;
        break;

      // Adoption requested — pet is pending but still available until approved
      case 'ADOPTION_REQUESTED':
      case 'PET_ADOPTION_REQUESTED':
        currentStatus = PetStatus.PENDING;
        break;

      // Adoption approved — pet is reserved (pending)
      case 'ADOPTION_APPROVED':
      case 'PET_ADOPTION_APPROVED':
        currentStatus = PetStatus.PENDING;
        break;

      // Pet adopted — permanently not available
      case 'ADOPTION_COMPLETED':
      case 'PET_ADOPTED':
        currentStatus = PetStatus.ADOPTED;
        break;

      // Custody started or pet custody active — temporarily unavailable
      case 'CUSTODY_STARTED':
      case 'PET_CUSTODY_ACTIVE':
        currentStatus = PetStatus.IN_CUSTODY;
        break;

      // Custody returned or pet returned — available again
      case 'CUSTODY_RETURNED':
      case 'PET_RETURNED':
        currentStatus = PetStatus.AVAILABLE;
        break;

      default:
        // Unknown event types are silently ignored for forward compatibility
        break;
    }
  }

  return currentStatus;
}
