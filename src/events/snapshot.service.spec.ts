import { Test, TestingModule } from '@nestjs/testing';
import { SnapshotService } from './snapshot.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType } from '@prisma/client';
import { adoptionReducer } from './adoption.reducer';

describe('SnapshotService and Replay Property Tests', () => {
  let service: SnapshotService;
  let prismaMock: any;

  const storedSnapshots: any[] = [];

  beforeEach(async () => {
    storedSnapshots.length = 0;
    prismaMock = {
      aggregateSnapshot: {
        upsert: jest.metaMask ?? jest.fn(async ({ where, create, update }) => {
          const existingIndex = storedSnapshots.findIndex(
            (s) => s.aggregateId === where.aggregateId_seq.aggregateId && s.seq === where.aggregateId_seq.seq,
          );
          if (existingIndex >= 0) {
            storedSnapshots[existingIndex] = { ...storedSnapshots[existingIndex], ...update };
            return storedSnapshots[existingIndex];
          } else {
            const newSnap = { id: 'snap-1', ...create };
            storedSnapshots.push(newSnap);
            return newSnap;
          }
        }),
        findMany: jest.fn(async ({ where }) => {
          return storedSnapshots
            .filter((s) => s.aggregateId === where.aggregateId)
            .sort((a, b) => b.seq - a.seq);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers:
      [
        SnapshotService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<SnapshotService>(SnapshotService);
  });

  it('computes consistent state hashes', () => {
    const stateA = { status: 'APPROVED', petId: '123', adopterId: '456' };
    const stateB = { adopterId: '456', petId: '123', status: 'APPROVED' };
    expect(service.computeStateHash(stateA)).toBe(service.computeStateHash(stateB));
  });

  it('saves and retrieves valid snapshots', async () => {
    const state = { status: 'REQUESTED', petId: 'pet-1' };
    await service.saveSnapshot('agg-1', EventEntityType.ADOPTION, 5, state);

    const latest = await service.getLatestValidSnapshot('agg-1');
    expect(latest).not.toBeNull();
    expect(latest?.seq).toBe(5);
    expect(latest?.state).toEqual(state);
  });

  it('detects and ignores corrupted snapshots', async () => {
    const state = { status: 'REQUESTED', petId: 'pet-1' };
    await service.saveSnapshot('agg-2', EventEntityType.ADOPTION, 5, state);

    // Tamper with stored state hash
    storedSnapshots[0].stateHash = 'corrupted-hash-value';

    const latest = await service.getLatestValidSnapshot('agg-2');
    expect(latest).toBeNull();
  });

  it('property test: snapshot replay equals full replay', () => {
    const events = [
      { eventType: 'ADOPTION_REQUESTED', payload: { petId: 'pet-99', adopterId: 'user-99' } },
      { eventType: 'ADOPTION_APPROVED', payload: { approvedBy: 'admin-1' } },
      { eventType: 'ADOPTION_ESCROW_CREATED', payload: { escrowAccountId: 'escrow-99' } },
      { eventType: 'ADOPTION_ESCROW_FUNDED', txHash: 'tx-hash-99', payload: {} },
      { eventType: 'ADOPTION_COMPLETED', payload: { completedAt: '2026-03-01T00:00:00.000Z' } },
    ];

    // Full replay
    let fullState: any = { status: 'INITIALIZED', adopterId: '', petId: '' };
    for (const e of events) {
      fullState = adoptionReducer(fullState, e);
    }

    // Partial replay up to event index 1, snapshot state, then replay remaining events
    let snapshotState: any = { status: 'INITIALIZED', adopterId: '', petId: '' };
    for (let i = 0; i < 2; i++) {
      snapshotState = adoptionReducer(snapshotState, events[i]);
    }

    const hash = service.computeStateHash(snapshotState);
    const reloadedState = { ...snapshotState };
    const reloadedHash = service.computeStateHash(reloadedState);
    expect(reloadedHash).toBe(hash);

    let postSnapshotState = reloadedState;
    for (let i = 2; i < events.length; i++) {
      postSnapshotState = adoptionReducer(postSnapshotState, events[i]);
    }

    expect(postSnapshotState).toEqual(fullState);
  });
});
