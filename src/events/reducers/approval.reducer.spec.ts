import { approvalReducer, ReplayedApprovalState } from './approval.reducer';
import { EventType } from '@prisma/client';

describe('approvalReducer fixture replay', () => {
  it('replays approval state default', () => {
    const initialState: ReplayedApprovalState = {};
    const next = approvalReducer(initialState, {
      eventType: EventType.USER_REGISTERED,
      payload: {},
    });
    expect(next).toEqual({});
  });
});
