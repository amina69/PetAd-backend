import { disputeReducer, ReplayedDisputeState } from './dispute.reducer';
import { EventType } from '@prisma/client';

describe('disputeReducer fixture replay', () => {
  it('replays dispute state default', () => {
    const initialState: ReplayedDisputeState = {};
    const next = disputeReducer(initialState, {
      eventType: EventType.USER_REGISTERED,
      payload: {},
    });
    expect(next).toEqual({});
  });
});
