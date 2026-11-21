import { TrustProofService } from './trust-proof.service';
import { hashEvent } from './trust-proof.crypto';
import { VerifyProofDto } from './dto/trust.dto';

describe('TrustProofService', () => {
  const storedEvent = {
    id: 'event-1',
    entityType: 'REVIEW',
    entityId: 'review-1',
    eventType: 'REVIEW_CREATED',
    actorId: 'reviewer-1',
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    payload: { subjectId: 'subject-1', rating: 5 },
  };
  const hash = hashEvent(storedEvent);

  function buildService() {
    const prisma = {
      eventLog: { findMany: jest.fn().mockResolvedValue([storedEvent]) },
      trustEvent: {
        findMany: jest.fn().mockResolvedValue([{ sourceEventId: 'event-1' }]),
      },
    };
    const anchors = {
      latestAnchorBatchForEvents: jest.fn().mockResolvedValue(new Map()),
      latestAnchorBatch: jest.fn().mockResolvedValue(null),
    };
    return {
      service: new TrustProofService(prisma as never, anchors as never),
      prisma,
    };
  }

  it('builds a bundle that verifies through the public endpoint', async () => {
    const { service } = buildService();
    const snapshot = {
      userId: 'subject-1',
      score: 61.5,
      algorithmVersion: 'trust-v1',
    };

    const bundle = await service.buildBundle(snapshot, [
      { sourceEventId: 'event-1' },
    ]);
    const dto: VerifyProofDto = {
      version: bundle.version,
      userId: bundle.userId,
      algorithmVersion: bundle.algorithmVersion,
      score: bundle.score,
      eventIds: bundle.eventIds,
      proofs: bundle.proofs,
      rootHash: bundle.rootHash,
      anchoredThrough: bundle.anchoredThrough,
    };

    await expect(service.verify(dto)).resolves.toMatchObject({ valid: true });
  });

  it('rejects a tampered proof without exposing payloads', async () => {
    const { service } = buildService();
    const snapshot = {
      userId: 'subject-1',
      score: 61.5,
      algorithmVersion: 'trust-v1',
    };
    const bundle = await service.buildBundle(snapshot, [
      { sourceEventId: 'event-1' },
    ]);

    const result = await service.verify({
      version: bundle.version,
      userId: bundle.userId,
      algorithmVersion: bundle.algorithmVersion,
      score: 99,
      eventIds: bundle.eventIds,
      proofs: bundle.proofs,
      rootHash: bundle.rootHash,
      anchoredThrough: bundle.anchoredThrough,
    });

    expect(result).toMatchObject({
      valid: false,
      reason: 'ROOT_HASH_MISMATCH',
    });
    expect(JSON.stringify(result)).not.toContain('rating');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
