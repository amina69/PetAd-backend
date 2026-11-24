export type ApprovalStatus = 'PENDING' | 'GRANTED' | 'REJECTED' | 'EXPIRED';

const DEFAULT_APPROVAL_STATUS: ApprovalStatus = 'PENDING';

/**
 * Replays an array of approval events to compute the final approval status.
 *
 * APPROVAL_REASSIGNED does not change status — it only updates the assignee
 * recorded in the event payload.
 *
 * @param events - Array of event-like objects with `eventType` and optional `payload`
 * @returns The computed {@link ApprovalStatus}
 */
export function approvalReducer(
  events: { eventType: string; payload?: Record<string, unknown> }[],
): ApprovalStatus {
  let status: ApprovalStatus = DEFAULT_APPROVAL_STATUS;

  for (const event of events) {
    switch (event.eventType) {
      case 'APPROVAL_REQUESTED':
        status = 'PENDING';
        break;
      case 'APPROVAL_GRANTED':
        status = 'GRANTED';
        break;
      case 'APPROVAL_REJECTED':
        status = 'REJECTED';
        break;
      case 'APPROVAL_EXPIRED':
        status = 'EXPIRED';
        break;
      case 'APPROVAL_REASSIGNED':
        // Reassignment keeps the current status; payload carries newAssigneeId
        break;
      default:
        break;
    }
  }

  return status;
}
