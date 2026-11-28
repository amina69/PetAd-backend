import { trustReducer, ReplayedTrustState } from './trust.reducer';
import { EventType } from '@prisma/client';

describe('trustReducer fixture replay', () => {
  it('replays trust score updates with absolute and delta values', () => {
    const initialState: ReplayedTrustState = { trustScore: 50, tier: 'STANDARD' };
    const s1 = trustReducer(initialState, {
      eventType: EventType.TRUST_SCORE_UPDATED,
      payload: { delta: 15, tier: 'VERIFIED' },
    });
    expect(s1.trustScore).toBe(65);
    expect(s1.tier).toBe('VERIFIED');

    const s2 = trustReducer(s1, {
      eventType: EventType.TRUST_SCORE_UPDATED,
      payload: { trustScore: 100 },
    });
    expect(s2.trustScore).toBe(100);
  });
});
