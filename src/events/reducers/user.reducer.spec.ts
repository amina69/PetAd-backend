import { userReducer, ReplayedUserState } from './user.reducer';
import { EventType } from '@prisma/client';

describe('userReducer fixture replay', () => {
  it('replays user registration and trust updates exhaustively', () => {
    const initialState: ReplayedUserState = { status: 'PENDING', trustScore: 50 };
    const state1 = userReducer(initialState, {
      eventType: EventType.USER_REGISTERED,
      payload: { email: 'test@example.com' },
    });
    expect(state1.status).toBe('REGISTERED');
    expect(state1.email).toBe('test@example.com');

    const state2 = userReducer(state1, {
      eventType: EventType.TRUST_SCORE_UPDATED,
      payload: { delta: 10 },
    });
    expect(state2.trustScore).toBe(60);

    const state3 = userReducer(state2, {
      eventType: EventType.USER_DELETED,
      payload: {},
    });
    expect(state3.status).toBe('DELETED');
  });
});
