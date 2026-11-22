import { scoreTrust, type TrustDecayConfig, type TrustEvent } from './index';

const decay: TrustDecayConfig = {
  ordinaryNegativeHalfLifeMs: 10,
  severeNegativeHalfLifeMs: 40,
  positiveHalfLifeMs: null,
};
const at = (milliseconds: number) => new Date(milliseconds);
const event = (
  id: string,
  weight: number,
  overrides: Partial<TrustEvent> = {},
): TrustEvent => ({
  id,
  userId: 'alice',
  occurredAt: at(0),
  weight,
  severity: 'ordinary',
  compensatesEventId: null,
  ...overrides,
});
const evaluate = (
  events: readonly TrustEvent[],
  baseline = 50,
  evaluatedAt = at(0),
  config = decay,
) =>
  scoreTrust({ userId: 'alice', baseline, events, evaluatedAt, decay: config });

describe('scoreTrust', () => {
  it('preserves the supplied baseline and clamps only the final sum', () => {
    expect(evaluate([], 0).score).toBe(0);
    expect(evaluate([], 100).score).toBe(100);
    expect(
      evaluate([event('positive', 50), event('negative', -60)], 90).score,
    ).toBe(80);
    expect(evaluate([event('negative', -50)], 20).score).toBe(0);
    expect(evaluate([event('positive', 50)], 90).score).toBe(100);
  });

  it('restores a clipped negative event by excluding it, not adding its weight', () => {
    const original = event('original', -20);
    const other = event('other', 10);
    const appeal = event('appeal', 20, { compensatesEventId: 'original' });
    expect(evaluate([original, other], 5).score).toBe(0);
    const result = evaluate([appeal, other, original], 5);
    expect(result.score).toBe(15);
    expect(result.history).toEqual([
      expect.objectContaining({
        event: appeal,
        status: 'compensation',
        appliedContribution: 0,
      }),
      expect.objectContaining({
        event: original,
        status: 'compensated',
        decayedContribution: -20,
        appliedContribution: 0,
        compensatedByEventId: 'appeal',
      }),
      expect.objectContaining({
        event: other,
        status: 'active',
        appliedContribution: 10,
      }),
    ]);
  });

  it('restores a clipped positive event without subtracting its nominal weight', () => {
    const original = event('original', 50);
    const appeal = event('appeal', -50, { compensatesEventId: 'original' });
    expect(evaluate([original], 90).score).toBe(100);
    expect(evaluate([original, appeal], 90).score).toBe(90);
  });

  it('reverses the decayed value at evaluation, while keeping both records', () => {
    const original = event('original', -40);
    const appeal = event('appeal', 40, {
      occurredAt: at(10),
      compensatesEventId: 'original',
    });
    expect(evaluate([original], 70, at(10)).score).toBe(50);
    const result = evaluate([appeal, original], 70, at(10));
    expect(result.score).toBe(70);
    expect(result.history.map(({ status }) => status)).toEqual([
      'compensated',
      'compensation',
    ]);
    expect(result.history[0].decayedContribution).toBe(-20);
    expect(result.history[1].event.compensatesEventId).toBe('original');
    expect(evaluate([appeal, original], 70, at(20)).score).toBe(70);
  });

  it('uses the requested half-lives for ordinary, severe, and positive events', () => {
    const ordinary = event('ordinary', -40);
    const severe = event('severe', -40, { severity: 'severe' });
    const positive = event('positive', 40);
    expect(evaluate([ordinary], 50, at(10)).score).toBe(30);
    expect(evaluate([severe], 50, at(40)).score).toBe(30);
    expect(evaluate([ordinary], 50, at(40)).score).toBe(47.5);
    expect(evaluate([positive], 50, at(10)).score).toBe(90);
    expect(
      evaluate([positive], 50, at(10), { ...decay, positiveHalfLifeMs: 10 })
        .score,
    ).toBe(70);
  });

  it('ignores future events and compensations until their evaluation time', () => {
    const original = event('original', -20);
    const appeal = event('appeal', 20, {
      occurredAt: at(10),
      compensatesEventId: 'original',
    });
    const future = event('future', 5, { occurredAt: at(20) });
    const before = evaluate([future, appeal, original], 50, at(0));
    expect(before.score).toBe(30);
    expect(before.history.map(({ status }) => status)).toEqual([
      'active',
      'pending',
      'pending',
    ]);
    expect(before.history[0].compensatedByEventId).toBeNull();
    expect(before.history[1].decayedContribution).toBeNull();
    const onAppeal = evaluate([future, appeal, original], 50, at(10));
    expect(onAppeal.score).toBe(50);
    expect(onAppeal.history.map(({ status }) => status)).toEqual([
      'compensated',
      'compensation',
      'pending',
    ]);
    expect(evaluate([future, appeal, original], 50, at(20)).score).toBe(55);
  });

  it('validates a mixed-user log and returns only the requested user history', () => {
    const bob = event('bob', -90, { userId: 'bob' });
    const bobAppeal = event('bob-appeal', 90, {
      userId: 'bob',
      compensatesEventId: 'bob',
    });
    const result = evaluate([bobAppeal, event('alice', 5), bob]);
    expect(result.score).toBe(55);
    expect(result.history.map(({ event: e }) => e.id)).toEqual(['alice']);
  });

  it('is deterministic under reordering including same-time compensation records', () => {
    const events = [
      event('b', 0.3),
      event('a', 0.2),
      event('z', -12, { severity: 'severe' }),
      event('c', 12, { compensatesEventId: 'z' }),
      event('other', -2, { userId: 'bob' }),
      event('future', 5, { occurredAt: at(100) }),
    ];
    const expected = evaluate(events, 60, at(20));
    expect(evaluate([...events].reverse(), 60, at(20))).toEqual(expected);
    for (let i = 0; i < events.length; i++) {
      expect(
        evaluate([...events.slice(i), ...events.slice(0, i)], 60, at(20)),
      ).toEqual(expected);
    }
    expect(expected.history.map(({ event: e }) => e.id)).toEqual([
      'a',
      'b',
      'c',
      'z',
      'future',
    ]);
  });

  it('avoids overflow and loss of a small baseline when large weights cancel', () => {
    const max = Number.MAX_VALUE;
    const events = [
      event('a', max),
      event('b', max),
      event('c', -max),
      event('d', -max),
      event('e', 5),
    ];
    expect(evaluate(events, 50).score).toBe(55);
    expect(evaluate([...events].reverse(), 50).score).toBe(55);
    expect(evaluate([event('a', max), event('b', max)], 50).score).toBe(100);
    expect(evaluate([event('a', -max), event('b', -max)], 50).score).toBe(0);
    expect(evaluate([event('tiny', Number.MIN_VALUE)], 0).score).toBe(
      Number.MIN_VALUE,
    );
  });

  it('does not mutate inputs and returns copied event dates', () => {
    const original = event('original', -10);
    const evaluatedAt = at(5);
    const events = Object.freeze([Object.freeze(original)]);
    const result = evaluate(events, 50, evaluatedAt);
    result.history[0].event.occurredAt.setTime(1000);
    expect(original.occurredAt.getTime()).toBe(0);
    expect(evaluatedAt.getTime()).toBe(5);
    expect(evaluate(events, 50, evaluatedAt).score).toBe(result.score);
  });

  it('always returns a finite score in range for varied valid inputs', () => {
    for (let i = 0; i <= 100; i++) {
      const events = Array.from({ length: 8 }, (_, j) =>
        event(`${j}`, ((i * 29 + j * 13) % 101) - 50, {
          severity: j % 2 ? 'severe' : 'ordinary',
          occurredAt: at(j * 3),
        }),
      );
      const score = evaluate(events, i, at(100)).score;
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(
      evaluate([event('fast', -20)], 50, at(1), {
        ordinaryNegativeHalfLifeMs: Number.MIN_VALUE,
        severeNegativeHalfLifeMs: 1,
        positiveHalfLifeMs: null,
      }).score,
    ).toBe(50);
  });

  it.each([
    [
      'orphan',
      [event('appeal', 10, { compensatesEventId: 'missing' })],
      /orphan compensation/,
    ],
    [
      'cross-user',
      [
        event('original', -10, { userId: 'bob' }),
        event('appeal', 10, { compensatesEventId: 'original' }),
      ],
      /cross-user compensation/,
    ],
    [
      'duplicate compensation',
      [
        event('original', -10),
        event('a', 10, { compensatesEventId: 'original' }),
        event('b', 10, { compensatesEventId: 'original' }),
      ],
      /duplicate compensation/,
    ],
    [
      'duplicate ID',
      [event('same', -10), event('same', 10)],
      /duplicate event id/,
    ],
    [
      'wrong weight',
      [
        event('original', -10),
        event('appeal', 9, { compensatesEventId: 'original' }),
      ],
      /weight must reverse/,
    ],
    [
      'before original',
      [
        event('original', -10, { occurredAt: at(5) }),
        event('appeal', 10, { compensatesEventId: 'original' }),
      ],
      /precedes original/,
    ],
    [
      'self-reference',
      [event('self', 0, { compensatesEventId: 'self' })],
      /reference an original/,
    ],
    [
      'compensation of compensation',
      [
        event('original', -10),
        event('appeal', 10, { compensatesEventId: 'original' }),
        event('again', -10, { compensatesEventId: 'appeal' }),
      ],
      /reference an original/,
    ],
  ])('rejects %s', (_label, events, message) => {
    expect(() => evaluate(events as TrustEvent[])).toThrow(message as RegExp);
  });

  it('rejects invalid records even if they are in the future or for another user', () => {
    expect(() =>
      evaluate([event('future', 1, { occurredAt: new Date(NaN) })]),
    ).toThrow(/event.occurredAt/);
    expect(() =>
      evaluate([
        event('future', 1, {
          occurredAt: at(100),
          compensatesEventId: 'missing',
        }),
      ]),
    ).toThrow(/orphan/);
    expect(() =>
      evaluate([event('other', Infinity, { userId: 'bob' })]),
    ).toThrow(/event.weight/);
    expect(() =>
      evaluate([
        event('bad', 1, { severity: 'invalid' as TrustEvent['severity'] }),
      ]),
    ).toThrow(/severity/);
    expect(() =>
      evaluate([
        event('bad', 1, { compensatesEventId: undefined as unknown as null }),
      ]),
    ).toThrow(/compensatesEventId/);
  });

  it('rejects invalid baselines, dates, IDs and decay configurations', () => {
    for (const baseline of [-1, 101, NaN, Infinity]) {
      expect(() => evaluate([], baseline)).toThrow(/baseline/);
    }
    expect(() => evaluate([], 50, new Date(NaN))).toThrow(/evaluatedAt/);
    expect(() => evaluate([event('', 1)])).toThrow(/event.id/);
    expect(() => evaluate([event('a', 1, { userId: ' ' })])).toThrow(
      /event.userId/,
    );
    const configs: TrustDecayConfig[] = [
      { ...decay, ordinaryNegativeHalfLifeMs: 0 },
      { ...decay, ordinaryNegativeHalfLifeMs: -1 },
      { ...decay, severeNegativeHalfLifeMs: 10 },
      { ...decay, severeNegativeHalfLifeMs: 5 },
      { ...decay, severeNegativeHalfLifeMs: Infinity },
      { ...decay, positiveHalfLifeMs: 0 },
      { ...decay, positiveHalfLifeMs: NaN },
      { ...decay, positiveHalfLifeMs: undefined as unknown as null },
    ];
    for (const config of configs)
      expect(() => evaluate([], 50, at(0), config)).toThrow();
  });
});
