import {
  TrustScoringConfig,
  TrustScoringEvent,
  TrustScoreFactor,
  TrustScoreResult,
} from './trust-scoring.types';

const DAY_MS = 24 * 60 * 60 * 1000;

const FACTOR_LABELS: Record<string, string> = {
  BASELINE: 'Baseline trust',
  AGREEMENT_COMPLETED: 'Completed agreements',
  POSITIVE_REVIEW: 'Positive reviews',
  NEUTRAL_REVIEW: 'Neutral reviews',
  NEGATIVE_REVIEW: 'Negative reviews',
  DISPUTE_OPENED: 'Opened disputes',
  DISPUTE_RESOLVED_IN_FAVOUR: 'Disputes resolved in your favour',
  DISPUTE_RESOLVED_AGAINST: 'Disputes resolved against you',
  VIOLATION: 'Custody violations',
  DOCUMENT_VERIFIED: 'Verified documents',
  MINIMUM_VOLUME: 'Low-volume confidence adjustment',
  RANGE_BOUND: 'Score range adjustment',
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toTimestamp(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid trust event timestamp: ${String(value)}`);
  }
  return timestamp;
}

function bandFor(score: number): string {
  if (score < 30) return 'POOR';
  if (score < 50) return 'FAIR';
  if (score < 70) return 'GOOD';
  if (score < 85) return 'VERY_GOOD';
  return 'EXCELLENT';
}

function labelFor(key: string): string {
  return FACTOR_LABELS[key] ?? key.replaceAll('_', ' ').toLowerCase();
}

export function calculateTrustScore(
  events: readonly TrustScoringEvent[],
  config: TrustScoringConfig,
  asOf: Date | string = new Date(),
): TrustScoreResult {
  const asOfTimestamp = toTimestamp(asOf);
  const ordered = [...events].sort((left, right) => {
    const timeDifference =
      toTimestamp(left.occurredAt) - toTimestamp(right.occurredAt);
    return timeDifference === 0
      ? left.id.localeCompare(right.id)
      : timeDifference;
  });

  const totals = new Map<string, { count: number; contribution: number }>();
  let positiveCount = 0;
  const halfLife = Math.max(config.halfLifeDays, Number.EPSILON);

  for (const event of ordered) {
    const baseWeight = config.weights[event.type] ?? 0;
    const multiplier = event.weight ?? 1;
    if (
      !Number.isFinite(baseWeight) ||
      !Number.isFinite(multiplier) ||
      baseWeight === 0
    ) {
      continue;
    }

    const ageDays = Math.max(
      0,
      (asOfTimestamp - toTimestamp(event.occurredAt)) / DAY_MS,
    );
    const recencyDecay = Math.pow(0.5, ageDays / halfLife);
    const isPositive =
      event.type === 'AGREEMENT_COMPLETED' ||
      event.type === 'POSITIVE_REVIEW' ||
      event.type === 'DISPUTE_RESOLVED_IN_FAVOUR' ||
      event.type === 'DOCUMENT_VERIFIED';
    const diminishingReturns = isPositive
      ? 1 / (1 + positiveCount * Math.max(0, config.diminishingRate))
      : 1;
    if (isPositive) positiveCount += 1;

    const contribution =
      baseWeight * multiplier * recencyDecay * diminishingReturns;
    const current = totals.get(event.type) ?? { count: 0, contribution: 0 };
    totals.set(event.type, {
      count: current.count + 1,
      contribution: current.contribution + contribution,
    });
  }

  const eventCount = ordered.length;
  const rawTotal = Array.from(totals.values()).reduce(
    (sum, value) => sum + value.contribution,
    0,
  );
  const confidence =
    config.minimumVolume <= 0
      ? 1
      : eventCount / (eventCount + config.minimumVolume);
  const volumeAdjustment = rawTotal * (confidence - 1);

  const factors: TrustScoreFactor[] = [
    {
      key: 'BASELINE',
      label: labelFor('BASELINE'),
      count: 1,
      contribution: config.baseScore,
    },
  ];

  for (const [key, value] of totals.entries()) {
    const contribution = round2(value.contribution);
    if (contribution === 0) continue;
    factors.push({
      key,
      label: labelFor(key),
      count: value.count,
      contribution,
    });
  }

  const volumeContribution = round2(volumeAdjustment);
  if (volumeContribution !== 0) {
    factors.push({
      key: 'MINIMUM_VOLUME',
      label: labelFor('MINIMUM_VOLUME'),
      count: eventCount,
      contribution: volumeContribution,
    });
  }

  const unclamped = round2(
    factors.reduce((sum, factor) => sum + factor.contribution, 0),
  );
  const score = round2(clamp(unclamped, 0, 100));
  const boundContribution = round2(score - unclamped);
  if (boundContribution !== 0) {
    factors.push({
      key: 'RANGE_BOUND',
      label: labelFor('RANGE_BOUND'),
      count: 1,
      contribution: boundContribution,
    });
  }

  factors.sort((left, right) => {
    const magnitudeDifference =
      Math.abs(right.contribution) - Math.abs(left.contribution);
    return magnitudeDifference === 0
      ? left.key.localeCompare(right.key)
      : magnitudeDifference;
  });

  return {
    score,
    band: bandFor(score),
    version: config.version,
    factors,
    eventCount,
    asOf: new Date(asOfTimestamp).toISOString(),
  };
}
