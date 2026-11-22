import {
  evaluateTrustPolicy,
  TrustDecisionInput,
  TrustPolicySettings,
  validateTrustPolicySettings,
} from './trust-policy';

const DAY = 86_400_000;
const now = new Date('2026-01-10T12:00:00.000Z');
const settings: TrustPolicySettings = {
  minimumCustodyTrustScore: 40,
  lowScoreThreshold: 60,
  lowScoreDepositMultiplier: '1.500000000000000001',
  manualReviewThreshold: 30,
  newAccountAgeDays: 7,
  newAccountRequestCap24h: 2,
};
const input: TrustDecisionInput = {
  requestType: 'CUSTODY',
  trustScore: 80,
  accountCreatedAt: new Date(now.getTime() - 30 * DAY),
  now,
  priorRequestTimes: [],
};
const at = (offset: number) => new Date(now.getTime() + offset);
const codes = (decision: ReturnType<typeof evaluateTrustPolicy>) =>
  decision.reasons.map((reason) => reason.code);

describe('trust policy', () => {
  it('allows a request with an explanatory reason and an exact unit multiplier', () => {
    expect(evaluateTrustPolicy(settings, input)).toEqual({
      outcome: 'ALLOW',
      reasons: [
        { code: 'ELIGIBLE', message: 'Your request meets the trust policy.' },
      ],
      depositMultiplier: '1',
      isNewAccount: false,
      recentRequestCount: 0,
    });
  });

  it('enforces the minimum only for custody and allows equality', () => {
    expect(
      evaluateTrustPolicy(settings, { ...input, trustScore: 40 }).outcome,
    ).toBe('ALLOW');
    const below = { ...input, trustScore: 39.999 };
    const custody = evaluateTrustPolicy(settings, below);
    expect(custody.outcome).toBe('DENY');
    expect(codes(custody)).toContain('CUSTODY_SCORE_BELOW_MINIMUM');
    const adoption = evaluateTrustPolicy(settings, {
      ...below,
      requestType: 'ADOPTION',
    });
    expect(adoption.outcome).toBe('ALLOW');
    expect(codes(adoption)).not.toContain('CUSTODY_SCORE_BELOW_MINIMUM');
  });

  it.each(['CUSTODY', 'ADOPTION'] as const)(
    'applies the precise low-score multiplier to %s strictly below its threshold',
    (requestType) => {
      const equal = evaluateTrustPolicy(settings, {
        ...input,
        requestType,
        trustScore: 60,
      });
      expect(equal.depositMultiplier).toBe('1');
      expect(codes(equal)).not.toContain('LOW_SCORE_DEPOSIT_MULTIPLIER');
      const below = evaluateTrustPolicy(settings, {
        ...input,
        requestType,
        trustScore: 59.999,
      });
      expect(below.depositMultiplier).toBe('1.500000000000000001');
      expect(codes(below)).toContain('LOW_SCORE_DEPOSIT_MULTIPLIER');
    },
  );

  it.each(['CUSTODY', 'ADOPTION'] as const)(
    'requires review for %s only below the review threshold',
    (requestType) => {
      const config = { ...settings, minimumCustodyTrustScore: 0 };
      expect(
        evaluateTrustPolicy(config, { ...input, requestType, trustScore: 30 })
          .outcome,
      ).toBe('ALLOW');
      const below = evaluateTrustPolicy(config, {
        ...input,
        requestType,
        trustScore: 29.999,
      });
      expect(below.outcome).toBe('MANUAL_REVIEW');
      expect(codes(below)).toContain('MANUAL_REVIEW_REQUIRED');
    },
  );

  it('returns every applicable reason, with denial taking precedence over review', () => {
    const result = evaluateTrustPolicy(settings, {
      ...input,
      trustScore: 20,
      accountCreatedAt: at(-DAY),
      priorRequestTimes: [at(-1), now],
    });
    expect(result.outcome).toBe('DENY');
    expect(codes(result)).toEqual([
      'CUSTODY_SCORE_BELOW_MINIMUM',
      'NEW_ACCOUNT_REQUEST_CAP_REACHED',
      'MANUAL_REVIEW_REQUIRED',
      'LOW_SCORE_DEPOSIT_MULTIPLIER',
    ]);
    expect(result.reasons.every((reason) => reason.message.length > 0)).toBe(
      true,
    );
    expect(result.depositMultiplier).toBe('1.500000000000000001');
  });

  it.each(['CUSTODY', 'ADOPTION'] as const)(
    'enforces the combined request cap for new accounts requesting %s',
    (requestType) => {
      const candidate = { ...input, requestType, accountCreatedAt: at(-DAY) };
      const below = evaluateTrustPolicy(settings, {
        ...candidate,
        priorRequestTimes: [at(-1)],
      });
      expect(below.outcome).toBe('ALLOW');
      const equal = evaluateTrustPolicy(settings, {
        ...candidate,
        priorRequestTimes: [at(-1), now],
      });
      expect(equal.outcome).toBe('DENY');
      expect(codes(equal)).toContain('NEW_ACCOUNT_REQUEST_CAP_REACHED');
      expect(equal.recentRequestCount).toBe(2);
    },
  );

  it('uses elapsed time for account age and excludes equality at the new-account boundary', () => {
    const candidate = { ...input, priorRequestTimes: [at(-1), now] };
    const younger = evaluateTrustPolicy(settings, {
      ...candidate,
      accountCreatedAt: at(-7 * DAY + 1),
    });
    expect(younger.isNewAccount).toBe(true);
    expect(younger.outcome).toBe('DENY');
    for (const offset of [-7 * DAY, -7 * DAY - 1]) {
      const old = evaluateTrustPolicy(settings, {
        ...candidate,
        accountCreatedAt: at(offset),
      });
      expect(old.isNewAccount).toBe(false);
      expect(old.outcome).toBe('ALLOW');
    }
  });

  it('counts the half-open rolling window (now - 24h, now]', () => {
    const result = evaluateTrustPolicy(settings, {
      ...input,
      accountCreatedAt: at(-6 * DAY),
      priorRequestTimes: [at(-DAY - 1), at(-DAY), at(-DAY + 1), now],
    });
    expect(result.recentRequestCount).toBe(2);
    expect(result.outcome).toBe('DENY');
  });

  it('handles zero age and zero cap explicitly without defaults', () => {
    const newInput = { ...input, accountCreatedAt: now };
    expect(
      evaluateTrustPolicy(
        { ...settings, newAccountAgeDays: 0, newAccountRequestCap24h: 0 },
        newInput,
      ).outcome,
    ).toBe('ALLOW');
    expect(
      evaluateTrustPolicy(
        { ...settings, newAccountAgeDays: 1, newAccountRequestCap24h: 0 },
        newInput,
      ).outcome,
    ).toBe('DENY');
  });

  it('does not overflow date differences across the full Date range', () => {
    const result = evaluateTrustPolicy(
      {
        ...settings,
        newAccountAgeDays: 200_000_000,
        newAccountRequestCap24h: 0,
      },
      {
        ...input,
        accountCreatedAt: new Date(-8_640_000_000_000_000),
        now: new Date(8_640_000_000_000_000),
      },
    );
    expect(result.isNewAccount).toBe(false);
    expect(result.outcome).toBe('ALLOW');
  });

  it('normalizes a configured multiplier without losing decimal precision', () => {
    const result = evaluateTrustPolicy(
      { ...settings, lowScoreDepositMultiplier: '001.250000000000000000' },
      { ...input, trustScore: 50 },
    );
    expect(result.depositMultiplier).toBe('1.25');
  });

  it('accepts explicitly configured boundary values', () => {
    expect(() =>
      validateTrustPolicySettings({
        minimumCustodyTrustScore: 0,
        lowScoreThreshold: 100,
        lowScoreDepositMultiplier: '100',
        manualReviewThreshold: 0,
        newAccountAgeDays: 200_000_000,
        newAccountRequestCap24h: Number.MAX_SAFE_INTEGER,
      }),
    ).not.toThrow();
  });

  it.each([
    ['minimumCustodyTrustScore', NaN],
    ['minimumCustodyTrustScore', -1],
    ['minimumCustodyTrustScore', 101],
    ['lowScoreThreshold', Infinity],
    ['lowScoreThreshold', -0.1],
    ['manualReviewThreshold', undefined],
    ['manualReviewThreshold', 100.1],
    ['newAccountAgeDays', NaN],
    ['newAccountAgeDays', -1],
    ['newAccountAgeDays', 0.5],
    ['newAccountAgeDays', 200_000_001],
    ['newAccountRequestCap24h', -1],
    ['newAccountRequestCap24h', Infinity],
    ['newAccountRequestCap24h', 1.5],
    ['newAccountRequestCap24h', Number.MAX_SAFE_INTEGER + 1],
    ['lowScoreDepositMultiplier', undefined],
    ['lowScoreDepositMultiplier', 1.5],
    ['lowScoreDepositMultiplier', 'NaN'],
    ['lowScoreDepositMultiplier', 'Infinity'],
    ['lowScoreDepositMultiplier', '0.999'],
    ['lowScoreDepositMultiplier', '100.0001'],
    ['lowScoreDepositMultiplier', '1e1'],
    ['lowScoreDepositMultiplier', '1.0000000000000000001'],
    ['lowScoreDepositMultiplier', '1'.repeat(41)],
  ])(
    'rejects invalid setting %s = %s even when it would not be used',
    (field, value) => {
      expect(() =>
        evaluateTrustPolicy({ ...settings, [field]: value }, input),
      ).toThrow();
    },
  );

  it('rejects missing settings instead of guessing defaults', () => {
    expect(() =>
      validateTrustPolicySettings(undefined as unknown as TrustPolicySettings),
    ).toThrow();
    for (const field of Object.keys(settings)) {
      const incomplete = { ...settings } as Partial<TrustPolicySettings>;
      delete incomplete[field as keyof TrustPolicySettings];
      expect(() =>
        validateTrustPolicySettings(incomplete as TrustPolicySettings),
      ).toThrow();
    }
  });

  it.each([
    { requestType: 'OTHER' },
    { trustScore: NaN },
    { trustScore: Infinity },
    { trustScore: -1 },
    { trustScore: 101 },
    { now: new Date(NaN) },
    { now: '2026-01-10' },
    { accountCreatedAt: new Date(NaN) },
    { accountCreatedAt: at(1) },
    { priorRequestTimes: undefined },
    { priorRequestTimes: [new Date(NaN)] },
    { priorRequestTimes: [at(1)] },
  ])('rejects invalid decision input %p', (overrides) => {
    expect(() =>
      evaluateTrustPolicy(settings, {
        ...input,
        ...overrides,
      } as TrustDecisionInput),
    ).toThrow();
  });
});
