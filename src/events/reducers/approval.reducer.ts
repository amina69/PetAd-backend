import { EventType, Prisma } from '@prisma/client';

export interface ReplayedApprovalState {
  status?: string;
  approvedBy?: string;
}

export interface ApprovalReplayEvent {
  eventType: EventType;
  payload: Prisma.JsonValue;
}

export function approvalReducer(
  state: ReplayedApprovalState,
  event: ApprovalReplayEvent,
): ReplayedApprovalState {
  switch (event.eventType) {
    case EventType.ADOPTION_REQUESTED:
    case EventType.ADOPTION_APPROVED:
    case EventType.ADOPTION_REJECTED:
    case EventType.ADOPTION_COMPLETED:
    case EventType.ADOPTION_CANCELLED:
    case EventType.PET_REGISTERED:
    case EventType.PET_LISTED:
    case EventType.PET_ADOPTED:
    case EventType.PET_RETURNED:
    case EventType.PET_CUSTODY_ACTIVE:
    case EventType.CUSTODY_CREATED:
    case EventType.PET_CUSTODY_CANCELLED:
    case EventType.CUSTODY_EXTENDED:
    case EventType.ESCROW_CREATED:
    case EventType.ESCROW_FUNDED:
    case EventType.ESCROW_RELEASED:
    case EventType.ESCROW_REFUNDED:
    case EventType.USER_REGISTERED:
    case EventType.USER_DELETED:
    case EventType.TRUST_SCORE_UPDATED:
    case EventType.CUSTODY_STARTED:
    case EventType.CUSTODY_COMPLETED:
    case EventType.CUSTODY_RETURNED:
    case EventType.CUSTODY_VIOLATION:
    case EventType.CUSTODY_CANCELLED:
    case EventType.USER_SUSPENDED:
    case EventType.USER_REINSTATED:
      return state;
    default: {
      const _exhaustiveCheck: never = event.eventType;
      return state;
    }
  }
}
