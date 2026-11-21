import { calculateTrustScore } from './calculate-trust-score';
import { DEFAULT_TRUST_SCORING_CONFIG } from './trust-scoring.config';
import { TrustEventKind, TrustScoringEvent } from './trust-scoring.types';

const KINDS: TrustEventKind[] = [
  'AGREEMENT_COMPLETED',
  'POSITIVE_REVIEW',
  'NEUTRAL_REVIEW',
  'NEGATIVE_REVIEW',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED_IN_FAVOUR',
  'DISPUTE_RESOLVED_AGAINST',
  'VIOLATION',
  'DOCUMENT_VERIFIED',
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('calculateTrustScore', () => {
  const asOf = new Date('2026-11-21T12:00:00.000Z');
  const config = DEFAULT_TRUST_SCORING_CONFIG;

  it('is a pure function for identical inputs', () => {
    const events: TrustScoringEvent[] = [
      {
        id: 'a',
        type: 'AGREEMENT_COMPLETED',
        occurredAt: '2026-01-01T00:00:00Z',
      },
      { id: 'b', type: 'POSITIVE_REVIEW', occurredAt: '2026-02-01T00:00:00Z' },
      { id: 'c', type: 'VIOLATION', occurredAt: '2026-03-01T00:00:00Z' },
    ];

    expect(calculateTrustScore(events, config, asOf)).toEqual(
      calculateTrustScore(events, config, asOf),
    );
  });

  it('does not depend on source event ordering', () => {
    const events: TrustScoringEvent[] = [
      { id: 'c', type: 'VIOLATION', occurredAt: '2026-03-01T00:00:00Z' },
      {
        id: 'a',
        type: 'AGREEMENT_COMPLETED',
        occurredAt: '2026-01-01T00:00:00Z',
      },
      { id: 'b', type: 'POSITIVE_REVIEW', occurredAt: '2026-02-01T00:00:00Z' },
    ];

    expect(calculateTrustScore(events, config, asOf)).toEqual(
      calculateTrustScore([...events].reverse(), config, asOf),
    );
  });

  it('keeps every generated score within [0, 100]', () => {
    const random = seededRandom(42);

    for (let iteration = 0; iteration < 250; iteration += 1) {
      const eventCount = Math.floor(random() * 40);
      const events = Array.from({ length: eventCount }, (_, index) => ({
        id: `event-${index}`,
        type: KINDS[Math.floor(random() * KINDS.length)],
        occurredAt: new Date(
          Date.parse('2020-01-01T00:00:00Z') +
            Math.floor(random() * 220_000_000_000),
        ),
        weight: 0.5 + random() * 2,
      }));

      const result = calculateTrustScore(events, config, asOf);

      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it('returns an explainable factor breakdown', () => {
    const result = calculateTrustScore(
      [
        {
          id: 'completion-1',
          type: 'AGREEMENT_COMPLETED',
          occurredAt: '2026-11-20T00:00:00Z',
        },
        {
          id: 'violation-1',
          type: 'VIOLATION',
          occurredAt: '2026-11-20T00:00:00Z',
        },
      ],
      config,
      asOf,
    );

    expect(result.version).toBe(config.version);
    expect(result.factors.length).toBeGreaterThanOrEqual(3);
    expect(result.factors.every((factor) => factor.label.length > 0)).toBe(
      true,
    );
    expect(result.factors.map((factor) => factor.key)).toContain('BASELINE');
    expect(result.factors.map((factor) => factor.key)).toContain(
      'AGREEMENT_COMPLETED',
    );
    expect(result.factors.map((factor) => factor.key)).toContain('VIOLATION');
    expect(
      result.factors.reduce((sum, factor) => sum + factor.contribution, 0),
    ).toBeCloseTo(result.score, 2);
  });

  it('diminishes repeated positive events and penalises violations more', () => {
    const pureVolumeConfig = { ...config, minimumVolume: 0 };
    const positive = (count: number): TrustScoringEvent[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `positive-${index}`,
        type: 'POSITIVE_REVIEW' as const,
        occurredAt: '2026-11-20T00:00:00Z',
      }));

    const one = calculateTrustScore(positive(1), pureVolumeConfig, asOf).score;
    const two = calculateTrustScore(positive(2), pureVolumeConfig, asOf).score;
    const violation = calculateTrustScore(
      [
        {
          id: 'violation',
          type: 'VIOLATION',
          occurredAt: '2026-11-20T00:00:00Z',
        },
      ],
      pureVolumeConfig,
      asOf,
    ).score;

    expect(two - one).toBeLessThan(one - config.baseScore);
    expect(violation).toBeLessThan(config.baseScore);
    expect(config.baseScore - violation).toBeGreaterThan(
      one - config.baseScore,
    );
  });

  it('shrinks low-volume scores toward the baseline', () => {
    const events: TrustScoringEvent[] = [
      {
        id: 'violation',
        type: 'VIOLATION',
        occurredAt: '2026-11-20T00:00:00Z',
      },
    ];
    const withMinimumVolume = calculateTrustScore(events, config, asOf).score;
    const withoutMinimumVolume = calculateTrustScore(
      events,
      { ...config, minimumVolume: 0 },
      asOf,
    ).score;

    expect(withMinimumVolume).toBeGreaterThan(withoutMinimumVolume);
  });
});
