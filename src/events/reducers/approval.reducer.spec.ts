import { approvalReducer } from './approval.reducer';

describe('approvalReducer', () => {
  it('returns PENDING for an empty event list', () => {
    expect(approvalReducer([])).toBe('PENDING');
  });

  it('returns PENDING after APPROVAL_REQUESTED', () => {
    expect(approvalReducer([{ eventType: 'APPROVAL_REQUESTED' }])).toBe('PENDING');
  });

  it('returns GRANTED after APPROVAL_GRANTED', () => {
    expect(
      approvalReducer([
        { eventType: 'APPROVAL_REQUESTED' },
        { eventType: 'APPROVAL_GRANTED' },
      ]),
    ).toBe('GRANTED');
  });

  it('returns REJECTED after APPROVAL_REJECTED', () => {
    expect(
      approvalReducer([
        { eventType: 'APPROVAL_REQUESTED' },
        { eventType: 'APPROVAL_REJECTED' },
      ]),
    ).toBe('REJECTED');
  });

  it('returns EXPIRED after APPROVAL_EXPIRED', () => {
    expect(
      approvalReducer([
        { eventType: 'APPROVAL_REQUESTED' },
        { eventType: 'APPROVAL_EXPIRED' },
      ]),
    ).toBe('EXPIRED');
  });

  it('APPROVAL_REASSIGNED does not change status', () => {
    expect(
      approvalReducer([
        { eventType: 'APPROVAL_REQUESTED' },
        { eventType: 'APPROVAL_GRANTED' },
        { eventType: 'APPROVAL_REASSIGNED', payload: { newAssigneeId: 'user-2' } },
      ]),
    ).toBe('GRANTED');
  });

  it('replaying the same events produces the same result (idempotent)', () => {
    const events = [
      { eventType: 'APPROVAL_REQUESTED' },
      { eventType: 'APPROVAL_GRANTED' },
    ];
    expect(approvalReducer(events)).toBe(approvalReducer(events));
  });

  it('ignores unknown event types', () => {
    expect(
      approvalReducer([
        { eventType: 'APPROVAL_REQUESTED' },
        { eventType: 'UNKNOWN_EVENT' },
      ]),
    ).toBe('PENDING');
  });
});
