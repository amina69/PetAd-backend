import { Logger } from '@nestjs/common';

export interface ReplayedAdoptionState {
  status: string;
  adopterId: string;
  petId: string;
  approvedBy?: string;
  escrowAccountId?: string;
  escrowTxHash?: string;
  completedAt?: string;
}

export interface AdoptionReplayEvent {
  eventType: string;
  actorId?: string | null;
  txHash?: string | null;
  createdAt?: string | Date | null;
  payload?: unknown;
}

const logger = new Logger('AdoptionReducer');

type EventPayload = Record<string, unknown>;

function getPayload(event: AdoptionReplayEvent): EventPayload {
  if (event.payload !== null && typeof event.payload === 'object') {
    return event.payload as EventPayload;
  }

  return {};
}

function getString(
  payload: EventPayload,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function getEventTimestamp(event: AdoptionReplayEvent): string | undefined {
  if (typeof event.createdAt === 'string') {
    return event.createdAt;
  }

  if (event.createdAt instanceof Date) {
    return event.createdAt.toISOString();
  }

  return undefined;
}

/**
 * Rebuilds adoption state by applying adoption events in event-log order.
 * Unknown events are deliberately ignored so unrelated events can safely be
 * replayed against an adoption aggregate.
 */
export function adoptionReducer(
  state: ReplayedAdoptionState,
  event: AdoptionReplayEvent,
): ReplayedAdoptionState {
  const payload = getPayload(event);

  switch (event.eventType) {
    case 'ADOPTION_REQUESTED': {
      const adopterId = getString(payload, 'adopterId', 'userId') ?? state.adopterId;
      const petId = getString(payload, 'petId') ?? state.petId;

      return {
        ...state,
        status: 'REQUESTED',
        adopterId,
        petId,
      };
    }

    case 'ADOPTION_APPROVED':
      return {
        ...state,
        status: 'APPROVED',
        approvedBy:
          getString(payload, 'approvedBy', 'adminId', 'actorId') ??
          event.actorId ??
          state.approvedBy,
      };

    case 'ADOPTION_REJECTED':
      return {
        ...state,
        status: 'REJECTED',
      };

    case 'ADOPTION_ESCROW_CREATED':
      return {
        ...state,
        status: 'ESCROW_CREATED',
        escrowAccountId:
          getString(payload, 'escrowAccountId', 'accountId') ??
          state.escrowAccountId,
      };

    case 'ADOPTION_ESCROW_FUNDED':
      return {
        ...state,
        status: 'ESCROW_FUNDED',
        escrowTxHash:
          getString(payload, 'escrowTxHash', 'txHash') ??
          event.txHash ??
          state.escrowTxHash,
      };

    case 'ADOPTION_COMPLETED':
      return {
        ...state,
        status: 'COMPLETED',
        completedAt:
          getString(payload, 'completedAt', 'timestamp') ??
          getEventTimestamp(event) ??
          state.completedAt,
      };

    default:
      logger.warn(`Unknown adoption event type: ${event.eventType}`);
      return state;
  }
}
