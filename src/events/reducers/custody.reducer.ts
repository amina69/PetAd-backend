import { CustodyStatus } from '@prisma/client';

/**
 * The initial/default custody status before any events are applied.
 */
const DEFAULT_CUSTODY_STATUS = CustodyStatus.PENDING;

/**
 * Replays an array of custody events to compute the final custody status.
 *
 * Event sequence logic:
 * - CUSTODY_CREATED  → PENDING (initial creation)
 * - CUSTODY_STARTED  → ACTIVE
 * - CUSTODY_COMPLETED → COMPLETED
 * - CUSTODY_CANCELLED → CANCELLED
 * - CUSTODY_EXTENDED  → no status change (only extends duration)
 *
 * The reducer processes events in chronological order; the last
 * status-determining event wins.
 *
 * @param events - Array of event-like objects with `eventType` and optional `payload`
 * @returns The computed {@link CustodyStatus}
 */
export function custodyReducer(
  events: { eventType: string; payload?: Record<string, unknown> }[],
): CustodyStatus {
  let currentStatus: CustodyStatus = DEFAULT_CUSTODY_STATUS;

  for (const event of events) {
    switch (event.eventType) {
      case 'CUSTODY_CREATED':
        currentStatus = CustodyStatus.PENDING;
        break;
      case 'CUSTODY_STARTED':
        currentStatus = CustodyStatus.ACTIVE;
        break;
      case 'CUSTODY_COMPLETED':
        currentStatus = CustodyStatus.COMPLETED;
        break;
      case 'CUSTODY_CANCELLED':
        currentStatus = CustodyStatus.CANCELLED;
        break;
      case 'CUSTODY_EXTENDED':
        // Extension does not change the status; duration is extended via payload
        break;
      default:
        // Unknown event types are silently ignored for forward compatibility
        break;
    }
  }

  return currentStatus;
}
