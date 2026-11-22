import {
  deriveOutcomeEvents,
  scoreTrust,
  type DisputeOutcome,
  type DisputeOutcomeParty,
} from './index';

const party = (
  overrides: Partial<DisputeOutcomeParty> = {},
): DisputeOutcomeParty => ({
  eventId: 'event-a',
  userId: 'alice',
  fault: 0.25,
  severity: 'ordinary',
  weights: { noFault: 4, fullFault: -20 },
  ...overrides,
});
const outcome = (
  first = party(),
  second = party({
    eventId: 'event-b',
    userId: 'bob',
    fault: 0.75,
    severity: 'severe',
  }),
): DisputeOutcome => ({ occurredAt: new Date(100), parties: [first, second] });

describe('deriveOutcomeEvents', () => {
  it('derives independently fault-weighted events for both parties', () => {
    const result = deriveOutcomeEvents(outcome());
    expect(result).toEqual([
      {
        id: 'event-a',
        userId: 'alice',
        occurredAt: new Date(100),
        weight: -2,
        severity: 'ordinary',
        compensatesEventId: null,
      },
      {
        id: 'event-b',
        userId: 'bob',
        occurredAt: new Date(100),
        weight: -14,
        severity: 'severe',
        compensatesEventId: null,
      },
    ]);
    const input = {
      baseline: 50,
      events: result,
      evaluatedAt: new Date(100),
      decay: {
        ordinaryNegativeHalfLifeMs: 10,
        severeNegativeHalfLifeMs: 40,
        positiveHalfLifeMs: null,
      },
    };
    expect(scoreTrust({ ...input, userId: 'alice' }).score).toBe(48);
    expect(scoreTrust({ ...input, userId: 'bob' }).score).toBe(36);
  });

  it('uses each party’s explicit weights and recognizes explicitly zero fault', () => {
    const result = deriveOutcomeEvents(
      outcome(
        party({ fault: 0, weights: { noFault: 6, fullFault: -40 } }),
        party({
          eventId: 'event-b',
          userId: 'bob',
          fault: 1,
          weights: { noFault: 9, fullFault: -7 },
        }),
      ),
    );
    expect(result.map(({ weight }) => weight)).toEqual([6, -7]);
  });

  it('does not infer missing or null fault from the other party', () => {
    const unknown = party({ fault: undefined });
    const known = party({ eventId: 'event-b', userId: 'bob', fault: 0.25 });
    expect(
      deriveOutcomeEvents(outcome(unknown, known)).map(({ userId }) => userId),
    ).toEqual(['bob']);
    expect(
      deriveOutcomeEvents(
        outcome(
          party({ fault: null }),
          party({ eventId: 'event-b', userId: 'bob', fault: undefined }),
        ),
      ),
    ).toEqual([]);
  });

  it('avoids overflow when interpolating extreme finite endpoints', () => {
    const max = Number.MAX_VALUE;
    const result = deriveOutcomeEvents(
      outcome(
        party({ fault: 0.5, weights: { noFault: max, fullFault: -max } }),
        party({
          eventId: 'event-b',
          userId: 'bob',
          fault: 0.5,
          weights: { noFault: -max, fullFault: max },
        }),
      ),
    );
    expect(result.map(({ weight }) => weight)).toEqual([0, 0]);
  });

  it('copies the supplied date without mutating the outcome', () => {
    const source = outcome();
    const result = deriveOutcomeEvents(source);
    result[0].occurredAt.setTime(999);
    expect(source.occurredAt.getTime()).toBe(100);
    expect(result[1].occurredAt.getTime()).toBe(100);
  });

  it.each([-0.01, 1.01, NaN, Infinity])('rejects invalid fault %s', (fault) => {
    expect(() => deriveOutcomeEvents(outcome(party({ fault })))).toThrow(
      /party.fault/,
    );
  });

  it('rejects invalid dates, identities, severities, weights, and party counts', () => {
    expect(() =>
      deriveOutcomeEvents({ ...outcome(), occurredAt: new Date(NaN) }),
    ).toThrow(/occurredAt/);
    expect(() => deriveOutcomeEvents(outcome(party({ userId: '' })))).toThrow(
      /userId/,
    );
    expect(() => deriveOutcomeEvents(outcome(party({ eventId: '' })))).toThrow(
      /eventId/,
    );
    expect(() =>
      deriveOutcomeEvents(
        outcome(party({ severity: 'bad' as DisputeOutcomeParty['severity'] })),
      ),
    ).toThrow(/severity/);
    expect(() =>
      deriveOutcomeEvents(
        outcome(party({ weights: { noFault: 0, fullFault: Infinity } })),
      ),
    ).toThrow(/fullFault/);
    expect(() =>
      deriveOutcomeEvents(outcome(party(), party({ eventId: 'event-b' }))),
    ).toThrow(/duplicate party userId/);
    expect(() =>
      deriveOutcomeEvents(outcome(party(), party({ userId: 'bob' }))),
    ).toThrow(/duplicate party eventId/);
    expect(() =>
      deriveOutcomeEvents({
        ...outcome(),
        parties: [] as unknown as DisputeOutcome['parties'],
      }),
    ).toThrow(/exactly two/);
  });
});
