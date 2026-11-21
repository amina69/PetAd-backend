export type TrustEventKind =
  | 'AGREEMENT_COMPLETED'
  | 'POSITIVE_REVIEW'
  | 'NEUTRAL_REVIEW'
  | 'NEGATIVE_REVIEW'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_RESOLVED_IN_FAVOUR'
  | 'DISPUTE_RESOLVED_AGAINST'
  | 'VIOLATION'
  | 'DOCUMENT_VERIFIED';

export interface TrustScoringEvent {
  id: string;
  type: TrustEventKind | string;
  occurredAt: Date | string;
  weight?: number;
}

export interface TrustScoringWeights {
  AGREEMENT_COMPLETED: number;
  POSITIVE_REVIEW: number;
  NEUTRAL_REVIEW: number;
  NEGATIVE_REVIEW: number;
  DISPUTE_OPENED: number;
  DISPUTE_RESOLVED_IN_FAVOUR: number;
  DISPUTE_RESOLVED_AGAINST: number;
  VIOLATION: number;
  DOCUMENT_VERIFIED: number;
}

export interface TrustScoringConfig {
  version: string;
  baseScore: number;
  halfLifeDays: number;
  minimumVolume: number;
  diminishingRate: number;
  weights: TrustScoringWeights;
}

export interface TrustScoreFactor {
  key: string;
  label: string;
  count: number;
  contribution: number;
}

export interface TrustScoreResult {
  score: number;
  band: string;
  version: string;
  factors: TrustScoreFactor[];
  eventCount: number;
  asOf: string;
}

const POSITIVE_KINDS = new Set<TrustEventKind>([
  'AGREEMENT_COMPLETED',
  'POSITIVE_REVIEW',
  'DISPUTE_RESOLVED_IN_FAVOUR',
  'DOCUMENT_VERIFIED',
]);

export function isPositiveTrustEvent(type: string): boolean {
  return POSITIVE_KINDS.has(type as TrustEventKind);
}
