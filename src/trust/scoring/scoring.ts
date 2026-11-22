import {
  assertFiniteNumber,
  assertId,
  assertSeverity,
  dateMilliseconds,
} from './validation';

export type TrustSeverity = 'ordinary' | 'severe';

export interface TrustEvent {
  readonly id: string;
  readonly userId: string;
  readonly occurredAt: Date;
  readonly weight: number;
  readonly severity: TrustSeverity;
  readonly compensatesEventId: string | null;
}

/** Half-lives are in milliseconds; null means positive events do not decay. */
export interface TrustDecayConfig {
  readonly ordinaryNegativeHalfLifeMs: number;
  readonly severeNegativeHalfLifeMs: number;
  readonly positiveHalfLifeMs: number | null;
}

export interface TrustScoreInput {
  readonly userId: string;
  readonly baseline: number;
  readonly events: readonly TrustEvent[];
  readonly evaluatedAt: Date;
  readonly decay: TrustDecayConfig;
}

export type TrustEventStatus =
  | 'active'
  | 'compensated'
  | 'compensation'
  | 'pending';

export interface TrustEventHistoryEntry {
  readonly event: TrustEvent;
  readonly status: TrustEventStatus;
  /** The original event's value at evaluation, even if compensated; null for
   * compensation records and events not yet effective. */
  readonly decayedContribution: number | null;
  /** Only active originals contribute to the score. */
  readonly appliedContribution: number;
  /** Set only once the linked compensation is effective. */
  readonly compensatedByEventId: string | null;
}

export interface TrustScoreResult {
  readonly score: number;
  /** All events for the requested user, ordered by time and then ID. */
  readonly history: readonly TrustEventHistoryEntry[];
}

interface TimedEvent {
  event: TrustEvent;
  time: number;
}

function validateDecay(decay: TrustDecayConfig): void {
  if (!decay || typeof decay !== 'object') {
    throw new Error('decay must be provided');
  }
  const { ordinaryNegativeHalfLifeMs, severeNegativeHalfLifeMs } = decay;
  assertFiniteNumber(ordinaryNegativeHalfLifeMs, 'ordinaryNegativeHalfLifeMs');
  assertFiniteNumber(severeNegativeHalfLifeMs, 'severeNegativeHalfLifeMs');
  if (
    ordinaryNegativeHalfLifeMs <= 0 ||
    severeNegativeHalfLifeMs <= ordinaryNegativeHalfLifeMs
  ) {
    throw new Error(
      'negative half-lives must be positive and ordinary must be shorter than severe',
    );
  }
  if (decay.positiveHalfLifeMs !== null) {
    assertFiniteNumber(decay.positiveHalfLifeMs, 'positiveHalfLifeMs');
    if (decay.positiveHalfLifeMs <= 0) {
      throw new Error('positiveHalfLifeMs must be positive or null');
    }
  }
}

function contribution(
  event: TrustEvent,
  ageMs: number,
  decay: TrustDecayConfig,
): number {
  const halfLife =
    event.weight < 0
      ? event.severity === 'ordinary'
        ? decay.ordinaryNegativeHalfLifeMs
        : decay.severeNegativeHalfLifeMs
      : decay.positiveHalfLifeMs;
  if (halfLife === null || ageMs === 0) return event.weight;
  const elapsedHalfLives = ageMs / halfLife;
  // A finite age divided by an extremely small half-life can overflow.
  if (!Number.isFinite(elapsedHalfLives)) return 0;
  return event.weight * 2 ** -elapsedHalfLives;
}

/**
 * Sum binary64 contributions exactly, then round once after clamping. This
 * prevents order-dependent rounding and intermediate overflow, including when
 * large positive and negative finite weights cancel. One unit is 2^-1074.
 */
function clampExactSum(values: readonly number[]): number {
  const view = new DataView(new ArrayBuffer(8));
  let total = 0n;
  for (const value of values) {
    view.setFloat64(0, value);
    const high = view.getUint32(0);
    const low = view.getUint32(4);
    const exponent = (high >>> 20) & 0x7ff;
    let units = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponent !== 0) {
      units = (units | (1n << 52n)) << BigInt(exponent - 1);
    }
    total += high >>> 31 ? -units : units;
  }
  if (total <= 0n) return 0;
  if (total >= 100n << 1074n) return 100;

  const shift = Math.max(0, total.toString(2).length - 53);
  let significant = total >> BigInt(shift);
  if (shift > 0) {
    const remainder = total - (significant << BigInt(shift));
    const halfway = 1n << BigInt(shift - 1);
    if (remainder > halfway || (remainder === halfway && significant % 2n)) {
      significant += 1n;
    }
  }
  return Number(significant) * 2 ** (shift - 1074);
}

/**
 * Recompute from an immutable baseline. The supplied log can contain several
 * users, but all records and links are validated before selecting one user.
 * Future records remain in history as pending. A compensation must be unique,
 * reference an earlier (or simultaneous) original for the same user, and have
 * exactly the opposite original weight. It is a marker, not an extra delta:
 * when effective, both records contribute zero, before the single final clamp.
 */
export function scoreTrust(input: TrustScoreInput): TrustScoreResult {
  assertId(input.userId, 'userId');
  assertFiniteNumber(input.baseline, 'baseline');
  if (input.baseline < 0 || input.baseline > 100) {
    throw new Error('baseline must be between 0 and 100');
  }
  const evaluationTime = dateMilliseconds(input.evaluatedAt, 'evaluatedAt');
  validateDecay(input.decay);
  if (!Array.isArray(input.events)) throw new Error('events must be an array');

  const byId = new Map<string, TimedEvent>();
  for (const event of input.events) {
    if (!event || typeof event !== 'object') {
      throw new Error('event must be an object');
    }
    assertId(event.id, 'event.id');
    assertId(event.userId, 'event.userId');
    assertFiniteNumber(event.weight, 'event.weight');
    assertSeverity(event.severity, 'event.severity');
    const time = dateMilliseconds(event.occurredAt, 'event.occurredAt');
    if (event.compensatesEventId !== null) {
      assertId(event.compensatesEventId, 'event.compensatesEventId');
    }
    if (byId.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    byId.set(event.id, {
      event: { ...event, occurredAt: new Date(time) },
      time,
    });
  }

  const sorted = [...byId.values()].sort((a, b) => {
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
  });
  const compensations = new Map<string, TimedEvent>();
  for (const item of sorted) {
    const { event } = item;
    if (event.compensatesEventId === null) continue;
    const original = byId.get(event.compensatesEventId);
    if (!original) {
      throw new Error(`orphan compensation: ${event.id}`);
    }
    if (original.event.compensatesEventId !== null) {
      throw new Error(
        `compensation must reference an original event: ${event.id}`,
      );
    }
    if (event.userId !== original.event.userId) {
      throw new Error(`cross-user compensation: ${event.id}`);
    }
    if (item.time < original.time) {
      throw new Error(`compensation precedes original event: ${event.id}`);
    }
    if (event.weight !== -original.event.weight) {
      throw new Error(`compensation weight must reverse original: ${event.id}`);
    }
    if (compensations.has(original.event.id)) {
      throw new Error(`duplicate compensation for event: ${original.event.id}`);
    }
    compensations.set(original.event.id, item);
  }

  const contributions = [input.baseline];
  const history: TrustEventHistoryEntry[] = [];
  for (const { event, time } of sorted) {
    if (event.userId !== input.userId) continue;
    const compensation = compensations.get(event.id);
    const effectiveCompensation =
      compensation && compensation.time <= evaluationTime ? compensation : null;
    const status: TrustEventStatus =
      time > evaluationTime
        ? 'pending'
        : event.compensatesEventId !== null
          ? 'compensation'
          : effectiveCompensation
            ? 'compensated'
            : 'active';
    const decayedContribution =
      time <= evaluationTime && event.compensatesEventId === null
        ? contribution(event, evaluationTime - time, input.decay)
        : null;
    const appliedContribution = status === 'active' ? decayedContribution! : 0;
    contributions.push(appliedContribution);
    history.push({
      event,
      status,
      decayedContribution,
      appliedContribution,
      compensatedByEventId: effectiveCompensation?.event.id ?? null,
    });
  }
  return { score: clampExactSum(contributions), history };
}
