import { EventType, Prisma } from '@prisma/client';

export interface ReplayedUserState {
  status?: string;
  trustScore?: number;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface UserReplayEvent {
  eventType: EventType;
  payload: Prisma.JsonValue;
}

export function userReducer(
  state: ReplayedUserState,
  event: UserReplayEvent,
):
 ReplayedUserState {
  switch (event.eventType) {
    case EventType.USER_REGISTERED:
      return { ...state, status: 'REGISTERED', ...((event.payload ?? {}) as object) };
    case EventType.USER_DELETED:
      return { ...state, status: 'DELETED', ...((event.payload ?? {}) as object) };
    case EventType.TRUST_SCORE_UPDATED:
    {
      const p = (event.payload ?? {}) as { trustScore?: number; delta?: number };
      if (typeof p.trustScore === 'number') {
        return { ...state, trustScore: p.trustScore };
      }
      if (typeof p.delta === 'number' && typeof state.trustScore === 'number') {
        return { ...state, trustScore: state.trustScore + p.delta };
      }
      return { ...state, ...p };
    }
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
