import { TrustProfileService } from './trust-profile.service';

describe('TrustProfileService', () => {
  const snapshot = {
    userId: 'subject-1',
    score: 72.5,
    band: 'GOOD',
    algorithmVersion: 'trust-v1',
    factors: [
      { key: 'VIOLATION', label: 'Violation', count: 1, contribution: -5 },
    ],
    eventCount: 2,
    completedAgreements: 4,
    disputesTotal: 1,
    disputesResolvedInFavour: 0,
    anchoredThrough: null,
    calculatedAt: new Date('2026-11-21T00:00:00.000Z'),
  };
  const proof = {
    version: 'trust-proof-v1',
    userId: 'subject-1',
    algorithmVersion: 'trust-v1',
    score: 72.5,
    eventIds: ['event-1'],
    proofs: [],
    rootHash: 'a'.repeat(64),
    anchoredThrough: null,
  };

  function buildService() {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subject-1',
          role: 'USER',
          stellarPublicKey: null,
          trustScore: 72.5,
          status: 'ACTIVE',
          deletedAt: null,
        }),
      },
      trustScore: { findUnique: jest.fn().mockResolvedValue(snapshot) },
      trustEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const scores = { recomputeUser: jest.fn() };
    const proofs = { buildBundle: jest.fn().mockResolvedValue(proof) };
    const service = new TrustProfileService(
      prisma as never,
      scores as never,
      proofs as never,
    );
    return { service, prisma, scores, proofs };
  }

  it('never exposes raw factors or score to non-owners', async () => {
    const { service } = buildService();

    const profile = await service.getProfile('subject-1', {
      sub: 'viewer-1',
    });

    expect(profile).not.toHaveProperty('score');
    expect(profile).not.toHaveProperty('factors');
    expect(profile).toMatchObject({
      id: 'subject-1',
      band: 'GOOD',
      isOwner: false,
      completedAgreements: 4,
    });
    expect(profile.proof).toEqual(proof);
  });

  it('exposes the explanation and score to the owner', async () => {
    const { service } = buildService();

    const profile = await service.getProfile('subject-1', {
      userId: 'subject-1',
    });

    expect(profile).toMatchObject({
      score: 72.5,
      isOwner: true,
      algorithmVersion: 'trust-v1',
      factors: snapshot.factors,
    });
  });

  it('computes a missing snapshot on demand', async () => {
    const { service, prisma, scores } = buildService();
    prisma.trustScore.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(snapshot);

    await service.getProfile('subject-1');

    expect(scores.recomputeUser).toHaveBeenCalledWith('subject-1');
  });
});
