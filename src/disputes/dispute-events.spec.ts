import { DisputeStatus } from '@prisma/client';
import {
  disputeReducer,
  getNotificationAudience,
  DISPUTE_NOTIFICATION_MAP,
  DISPUTE_EVENT_TYPES,
} from './dispute-events';

describe('disputeReducer', () => {
  it('starts with OPEN status', () => {
    const state = disputeReducer([{ eventType: 'DISPUTE_OPENED', payload: {} }]);
    expect(state.status).toBe(DisputeStatus.OPEN);
    expect(state.commentCount).toBe(0);
    expect(state.evidenceCount).toBe(0);
  });

  it('transitions to UNDER_REVIEW on DISPUTE_ASSIGNED', () => {
    const state = disputeReducer([
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'DISPUTE_ASSIGNED', payload: { assigneeId: 'admin-1' } },
    ]);
    expect(state.status).toBe(DisputeStatus.UNDER_REVIEW);
    expect(state.assigneeId).toBe('admin-1');
  });

  it('increments commentCount per DISPUTE_COMMENT_ADDED', () => {
    const state = disputeReducer([
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'DISPUTE_COMMENT_ADDED', payload: { commentId: 'c1' } },
      { eventType: 'DISPUTE_COMMENT_ADDED', payload: { commentId: 'c2' } },
    ]);
    expect(state.commentCount).toBe(2);
  });

  it('increments evidenceCount per DISPUTE_EVIDENCE_ADDED', () => {
    const state = disputeReducer([
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'DISPUTE_EVIDENCE_ADDED', payload: { fileHash: 'abc' } },
    ]);
    expect(state.evidenceCount).toBe(1);
  });

  it('transitions to RESOLVED on DISPUTE_RESOLVED', () => {
    const state = disputeReducer([
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'DISPUTE_RESOLVED', payload: { resolution: 'Refunded' } },
    ]);
    expect(state.status).toBe(DisputeStatus.RESOLVED);
    expect(state.resolution).toBe('Refunded');
  });

  it('transitions to RESOLVED on DISPUTE_WITHDRAWN', () => {
    const state = disputeReducer([
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'DISPUTE_WITHDRAWN', payload: {} },
    ]);
    expect(state.status).toBe(DisputeStatus.RESOLVED);
  });

  it('replays full lifecycle correctly', () => {
    const events = [
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'DISPUTE_COMMENT_ADDED', payload: {} },
      { eventType: 'DISPUTE_EVIDENCE_ADDED', payload: { fileHash: 'h1' } },
      { eventType: 'DISPUTE_ASSIGNED', payload: { assigneeId: 'admin-2' } },
      { eventType: 'DISPUTE_COMMENT_ADDED', payload: {} },
      { eventType: 'DISPUTE_RESOLVED', payload: { resolution: 'Closed' } },
    ];
    const state = disputeReducer(events);
    expect(state.status).toBe(DisputeStatus.RESOLVED);
    expect(state.commentCount).toBe(2);
    expect(state.evidenceCount).toBe(1);
    expect(state.assigneeId).toBe('admin-2');
    expect(state.resolution).toBe('Closed');
  });

  it('ignores unknown event types', () => {
    const state = disputeReducer([
      { eventType: 'DISPUTE_OPENED', payload: {} },
      { eventType: 'SOME_FUTURE_EVENT', payload: {} },
    ]);
    expect(state.status).toBe(DisputeStatus.OPEN);
  });

  it('returns default state for empty event list', () => {
    const state = disputeReducer([]);
    expect(state.status).toBe(DisputeStatus.OPEN);
    expect(state.commentCount).toBe(0);
  });
});

describe('getNotificationAudience', () => {
  it('returns COUNTERPARTY for DISPUTE_OPENED', () => {
    expect(getNotificationAudience('DISPUTE_OPENED')).toBe('COUNTERPARTY');
  });

  it('returns BOTH for DISPUTE_ASSIGNED', () => {
    expect(getNotificationAudience('DISPUTE_ASSIGNED')).toBe('BOTH');
  });

  it('returns BOTH for DISPUTE_RESOLVED', () => {
    expect(getNotificationAudience('DISPUTE_RESOLVED')).toBe('BOTH');
  });

  it('returns COUNTERPARTY for DISPUTE_EVIDENCE_ADDED', () => {
    expect(getNotificationAudience('DISPUTE_EVIDENCE_ADDED')).toBe('COUNTERPARTY');
  });

  it('returns NONE for unknown event types', () => {
    expect(getNotificationAudience('UNKNOWN_EVENT')).toBe('NONE');
  });

  it('covers all defined dispute event types', () => {
    for (const type of DISPUTE_EVENT_TYPES) {
      const audience = getNotificationAudience(type);
      expect(['COUNTERPARTY', 'BOTH', 'ASSIGNEE', 'NONE']).toContain(audience);
    }
  });

  it('DISPUTE_NOTIFICATION_MAP has an entry for every event type', () => {
    for (const type of DISPUTE_EVENT_TYPES) {
      expect(DISPUTE_NOTIFICATION_MAP[type]).toBeDefined();
    }
  });
});
