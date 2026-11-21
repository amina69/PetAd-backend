import { AbuseSignalType } from '@prisma/client';
import { AntiAbuseDetector } from './anti-abuse.detector';
import { ReviewRecord, UserRecord } from './anti-abuse.types';

describe('AntiAbuseDetector', () => {
  const detector = new AntiAbuseDetector();
  const now = new Date('2026-11-21T00:00:00.000Z');

  const review = (
    id: string,
    reviewerId: string,
    revieweeId: string,
    createdAt = '2026-11-20T00:00:00.000Z',
  ): ReviewRecord => ({
    id,
    reviewerId,
    revieweeId,
    rating: 5,
    createdAt: new Date(createdAt),
  });

  const thresholds = {
    minAccountAgeDays: 30,
    reviewBurstWindowDays: 7,
    reviewBurstThreshold: 5,
    agreementThreshold: 3,
  };

  it('flags a synthetic ring of five accounts', () => {
    const ring = [
      review('r1', 'a', 'b'),
      review('r2', 'b', 'c'),
      review('r3', 'c', 'd'),
      review('r4', 'd', 'e'),
      review('r5', 'e', 'a'),
    ];

    const signals = detector.detectReciprocalRings(ring);

    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.type === AbuseSignalType.REVIEW_RING)).toBe(true);
    expect(signals.map((signal) => signal.reviewId).sort()).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
    ]);
    expect(signals[0].reason).toMatch(/review ring/i);
  });

  it('flags reciprocal reviews between two accounts', () => {
    const signals = detector.detectReciprocalRings([
      review('r1', 'a', 'b'),
      review('r2', 'b', 'a'),
    ]);

    expect(signals.map((signal) => signal.reviewId).sort()).toEqual(['r1', 'r2']);
    expect(signals[0].type).toBe(AbuseSignalType.RECIPROCAL_REVIEW);
  });

  it('does not flag unrelated one-way reviews', () => {
    expect(
      detector.detectReciprocalRings([
        review('r1', 'a', 'b'),
        review('r2', 'c', 'b'),
      ]),
    ).toHaveLength(0);
  });

  it('detects repeated agreements between the same two accounts', () => {
    const agreements = Array.from({ length: 3 }, (_, index) => ({
      id: `agreement-${index}`,
      participantIds: ['a', 'b'] as [string, string],
      createdAt: now,
    }));

    const signals = detector.detectRepeatedAgreements(agreements, 3);

    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe(AbuseSignalType.REPEATED_AGREEMENT);
    expect(signals[0].metadata).toMatchObject({ count: 3 });
  });

  it('detects bursts from new accounts but not established ones', () => {
    const users: UserRecord[] = [
      { id: 'new', createdAt: new Date('2026-11-18T00:00:00.000Z') },
      { id: 'old', createdAt: new Date('2020-01-01T00:00:00.000Z') },
    ];
    const reviews = [
      ...Array.from({ length: 5 }, (_, index) =>
        review(`new-${index}`, 'new', `target-${index}`, '2026-11-20T00:00:00.000Z'),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        review(`old-${index}`, 'old', `target-${index}`, '2026-11-20T00:00:00.000Z'),
      ),
    ];

    const signals = detector.detectNewAccountBursts(
      reviews,
      users,
      thresholds,
      now,
    );

    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.actorUserId === 'new')).toBe(true);
  });

  it('flags hashed device and ip reuse across accounts', () => {
    const signals = detector.detectSharedSignals([
      {
        type: AbuseSignalType.SHARED_DEVICE,
        hashedValue: 'hash-1',
        userIds: ['a', 'b'],
      },
      {
        type: AbuseSignalType.SHARED_IP,
        hashedValue: 'hash-2',
        userIds: ['c'],
      },
    ]);

    expect(signals).toHaveLength(2);
    expect(signals[0].type).toBe(AbuseSignalType.SHARED_DEVICE);
    expect(signals[0].hashedValue).toBe('hash-1');
  });
});
