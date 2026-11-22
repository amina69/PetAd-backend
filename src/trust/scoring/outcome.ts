import type { TrustEvent, TrustSeverity } from './scoring';
import {
  assertFiniteNumber,
  assertId,
  assertSeverity,
  dateMilliseconds,
} from './validation';

/** Caller-supplied outcome policy, in score points for each endpoint. */
export interface OutcomeWeights {
  readonly noFault: number;
  readonly fullFault: number;
}

export interface DisputeOutcomeParty {
  readonly eventId: string;
  readonly userId: string;
  /** Fraction from 0 to 1; null or absent means fault has not been determined. */
  readonly fault?: number | null;
  readonly severity: TrustSeverity;
  readonly weights: OutcomeWeights;
}

export interface DisputeOutcome {
  readonly occurredAt: Date;
  readonly parties: readonly [DisputeOutcomeParty, DisputeOutcomeParty];
}

/**
 * Derive one original event for each party with an explicitly supplied fault.
 * Weights are linearly interpolated between that party's supplied endpoints.
 * Unknown fault produces no event; it is never treated as zero or inferred
 * from the other party. IDs, severities, weights and time are caller-supplied.
 */
export function deriveOutcomeEvents(outcome: DisputeOutcome): TrustEvent[] {
  const time = dateMilliseconds(outcome.occurredAt, 'outcome.occurredAt');
  if (!Array.isArray(outcome.parties) || outcome.parties.length !== 2) {
    throw new Error('outcome must have exactly two parties');
  }
  const userIds = new Set<string>();
  const eventIds = new Set<string>();
  const events: TrustEvent[] = [];
  for (const party of outcome.parties) {
    if (!party || typeof party !== 'object') {
      throw new Error('outcome party must be an object');
    }
    assertId(party.userId, 'party.userId');
    assertId(party.eventId, 'party.eventId');
    assertSeverity(party.severity, 'party.severity');
    if (userIds.has(party.userId)) throw new Error('duplicate party userId');
    if (eventIds.has(party.eventId)) throw new Error('duplicate party eventId');
    userIds.add(party.userId);
    eventIds.add(party.eventId);
    if (!party.weights || typeof party.weights !== 'object') {
      throw new Error('party.weights must be provided');
    }
    const { noFault, fullFault } = party.weights;
    assertFiniteNumber(noFault, 'weights.noFault');
    assertFiniteNumber(fullFault, 'weights.fullFault');
    if (party.fault === null || party.fault === undefined) continue;
    assertFiniteNumber(party.fault, 'party.fault');
    if (party.fault < 0 || party.fault > 1) {
      throw new Error('party.fault must be between 0 and 1');
    }
    // Avoid an overflowing endpoint difference when the signs differ.
    const weight =
      (noFault < 0 && fullFault > 0) || (noFault > 0 && fullFault < 0)
        ? noFault * (1 - party.fault) + fullFault * party.fault
        : noFault + (fullFault - noFault) * party.fault;
    events.push({
      id: party.eventId,
      userId: party.userId,
      occurredAt: new Date(time),
      weight,
      severity: party.severity,
      compensatesEventId: null,
    });
  }
  return events;
}
