import { DisputeStatus } from '@prisma/client';

export const DISPUTE_EVENT_TYPES = [
  'DISPUTE_OPENED',
  'DISPUTE_COMMENT_ADDED',
  'DISPUTE_EVIDENCE_ADDED',
  'DISPUTE_ASSIGNED',
  'DISPUTE_RESOLVED',
  'DISPUTE_WITHDRAWN',
] as const;

export type DisputeEventType = (typeof DISPUTE_EVENT_TYPES)[number];

export interface DisputeEvent {
  eventType: string;
  payload: Record<string, unknown>;
}

export interface DisputeAggregate {
  status: DisputeStatus;
  assigneeId?: string;
  resolution?: string;
  commentCount: number;
  evidenceCount: number;
}

export function disputeReducer(events: DisputeEvent[]): DisputeAggregate {
  let state: DisputeAggregate = {
    status: DisputeStatus.OPEN,
    commentCount: 0,
    evidenceCount: 0,
  };

  for (const event of events) {
    switch (event.eventType) {
      case 'DISPUTE_OPENED':
        state = { ...state, status: DisputeStatus.OPEN };
        break;
      case 'DISPUTE_ASSIGNED':
        state = {
          ...state,
          status: DisputeStatus.UNDER_REVIEW,
          assigneeId: event.payload.assigneeId as string | undefined,
        };
        break;
      case 'DISPUTE_COMMENT_ADDED':
        state = { ...state, commentCount: state.commentCount + 1 };
        break;
      case 'DISPUTE_EVIDENCE_ADDED':
        state = { ...state, evidenceCount: state.evidenceCount + 1 };
        break;
      case 'DISPUTE_RESOLVED':
        state = {
          ...state,
          status: DisputeStatus.RESOLVED,
          resolution: event.payload.resolution as string | undefined,
        };
        break;
      case 'DISPUTE_WITHDRAWN':
        state = { ...state, status: DisputeStatus.RESOLVED };
        break;
      default:
        break;
    }
  }

  return state;
}

export type NotificationAudience = 'COUNTERPARTY' | 'BOTH' | 'ASSIGNEE' | 'NONE';

export const DISPUTE_NOTIFICATION_MAP: Record<DisputeEventType, NotificationAudience> = {
  DISPUTE_OPENED: 'COUNTERPARTY',
  DISPUTE_COMMENT_ADDED: 'COUNTERPARTY',
  DISPUTE_EVIDENCE_ADDED: 'COUNTERPARTY',
  DISPUTE_ASSIGNED: 'BOTH',
  DISPUTE_RESOLVED: 'BOTH',
  DISPUTE_WITHDRAWN: 'COUNTERPARTY',
};

export function getNotificationAudience(
  eventType: DisputeEventType | string,
): NotificationAudience {
  return DISPUTE_NOTIFICATION_MAP[eventType as DisputeEventType] ?? 'NONE';
}
