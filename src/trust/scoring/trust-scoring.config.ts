import type { TrustScoringConfig } from './trust-scoring.types';

export const DEFAULT_TRUST_SCORING_CONFIG: TrustScoringConfig = {
  version: 'trust-v1',
  baseScore: 50,
  halfLifeDays: 180,
  minimumVolume: 8,
  diminishingRate: 0.35,
  weights: {
    AGREEMENT_COMPLETED: 6,
    POSITIVE_REVIEW: 5,
    NEUTRAL_REVIEW: 1,
    NEGATIVE_REVIEW: -12,
    DISPUTE_OPENED: -6,
    DISPUTE_RESOLVED_IN_FAVOUR: 2,
    DISPUTE_RESOLVED_AGAINST: -10,
    VIOLATION: -18,
    DOCUMENT_VERIFIED: 2,
  },
};

export function mergeTrustScoringConfig(
  overrides: Partial<TrustScoringConfig> = {},
): TrustScoringConfig {
  return {
    ...DEFAULT_TRUST_SCORING_CONFIG,
    ...overrides,
    weights: {
      ...DEFAULT_TRUST_SCORING_CONFIG.weights,
      ...(overrides.weights ?? {}),
    },
  };
}
