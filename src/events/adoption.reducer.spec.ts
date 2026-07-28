import {
  adoptionReducer,
  ReplayedAdoptionState,
} from './adoption.reducer';

describe('adoptionReducer', () => {
  const initialState: ReplayedAdoptionState = {
    status: 'INITIALIZED',
    adopterId: '',
    petId: '',
  };

  it('rebuilds the complete adoption lifecycle', () => {
    const requested = adoptionReducer(initialState, {
      eventType: 'ADOPTION_REQUESTED',
      payload: {
        adopterId: 'adopter-1',
        petId: 'pet-1',
      },
    });

    const approved = adoptionReducer(requested, {
      eventType: 'ADOPTION_APPROVED',
      payload: {
        approvedBy: 'admin-1',
      },
    });

    const escrowCreated = adoptionReducer(approved, {
      eventType: 'ADOPTION_ESCROW_CREATED',
      payload: {
        escrowAccountId: 'escrow-1',
      },
    });

    const escrowFunded = adoptionReducer(escrowCreated, {
      eventType: 'ADOPTION_ESCROW_FUNDED',
      txHash: 'tx-1',
      payload: {},
    });

    const completed = adoptionReducer(escrowFunded, {
      eventType: 'ADOPTION_COMPLETED',
      payload: {
        completedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(completed).toEqual({
      status: 'COMPLETED',
      adopterId: 'adopter-1',
      petId: 'pet-1',
      approvedBy: 'admin-1',
      escrowAccountId: 'escrow-1',
      escrowTxHash: 'tx-1',
      completedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('logs and passes through unknown events unchanged', () => {
    const warnSpy = jest
      .spyOn((require('@nestjs/common').Logger.prototype as { warn: jest.Mock }), 'warn')
      .mockImplementation(() => undefined);

    const state = {
      ...initialState,
      status: 'APPROVED',
      adopterId: 'adopter-1',
      petId: 'pet-1',
    };

    const result = adoptionReducer(state, {
      eventType: 'ADOPTION_UNKNOWN',
      payload: { ignored: true },
    });

    expect(result).toBe(state);
    expect(warnSpy).toHaveBeenCalledWith(
      'Unknown adoption event type: ADOPTION_UNKNOWN',
    );

    warnSpy.mockRestore();
  });
});
