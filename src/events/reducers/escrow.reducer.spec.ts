import { escrowReducer, ReplayedEscrowState } from './escrow.reducer';
import { EventType } from '@prisma/client';

describe('escrowReducer fixture replay', () => {
  it('replays escrow lifecycle fixture successfully', () => {
    const initialState: ReplayedEscrowState = {};
    const s1 = escrowReducer(initialState, {
      eventType: EventType.ESCROW_CREATED,
      payload: { amount: 100 },
    });
    expect(s1.status).toBe('CREATED');
    expect(s1.amount).toBe(100);

    const s2 = escrowReducer(s1, {
      eventType: EventType.ESCROW_FUNDED,
      payload: {},
    });
    expect(s2.status).toBe('FUNDED');

    const s3 = escrowReducer(s2, {
      eventType: EventType.ESCROW_RELEASED,
      txHash: 'tx-rel-1',
      payload: {},
    });
    expect(s3.status).toBe('RELEASED');
    expect(s3.releaseTxHash).toBe('tx-rel-1');
  });
});
