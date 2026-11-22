import { Decimal } from '@prisma/client/runtime/client';
import { ApprovedFeePricing, calculateFeeBreakdown } from './fee-breakdown';
import { evaluateTrustPolicy, TrustPolicySettings } from './trust-policy';

const pricing: ApprovedFeePricing = {
  dailyRateMinor: 333,
  serviceFeePercentage: '7.5',
  baseDepositMinor: 333,
};

describe('fee breakdown', () => {
  it('calculates and rounds each line independently in integer USD cents', () => {
    expect(calculateFeeBreakdown(3, pricing, '1.50')).toEqual({
      nights: 3,
      dailyRateMinor: 333,
      subtotalMinor: 999,
      serviceFeeMinor: 75,
      baseDepositMinor: 333,
      depositMultiplier: '1.5',
      depositMinor: 500,
      totalMinor: 1574,
      currency: 'USD',
    });
  });

  it('rounds half cents up independently before summing, and excludes deposit from the fee base', () => {
    expect(
      calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: 1,
          serviceFeePercentage: '50',
          baseDepositMinor: 1,
        },
        '1.5',
      ),
    ).toEqual({
      nights: 1,
      dailyRateMinor: 1,
      subtotalMinor: 1,
      serviceFeeMinor: 1,
      baseDepositMinor: 1,
      depositMultiplier: '1.5',
      depositMinor: 2,
      totalMinor: 4,
      currency: 'USD',
    });
  });

  it('rounds just below and just above half a cent without losing significant digits', () => {
    const below = calculateFeeBreakdown(
      1,
      {
        dailyRateMinor: 4_999_999_999_999_999,
        serviceFeePercentage: '0.00000000000001',
        baseDepositMinor: 0,
      },
      '1',
    );
    const above = calculateFeeBreakdown(
      1,
      {
        dailyRateMinor: 5_000_000_000_000_001,
        serviceFeePercentage: '0.00000000000001',
        baseDepositMinor: 0,
      },
      '1',
    );
    expect(below.serviceFeeMinor).toBe(0);
    expect(above.serviceFeeMinor).toBe(1);
    expect(above.totalMinor).toBe(5_000_000_000_000_002);
    const deposit = calculateFeeBreakdown(
      1,
      {
        dailyRateMinor: 0,
        serviceFeePercentage: '0',
        baseDepositMinor: 5_000_000_000_000_001,
      },
      '1.0000000000000001',
    );
    expect(deposit.depositMinor).toBe(5_000_000_000_000_002);
  });

  it('is isolated from global Prisma Decimal precision and rounding changes', () => {
    const precision = Decimal.precision;
    const rounding = Decimal.rounding;
    try {
      Decimal.set({ precision: 5, rounding: Decimal.ROUND_DOWN });
      const result = calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: 5_000_000_000_000_001,
          serviceFeePercentage: '0.00000000000001',
          baseDepositMinor: 0,
        },
        '1',
      );
      expect(result.serviceFeeMinor).toBe(1);
      expect(result.totalMinor).toBe(5_000_000_000_000_002);
    } finally {
      Decimal.set({ precision, rounding });
    }
  });

  it('uses a policy decision multiplier without converting it to a number', () => {
    const policy: TrustPolicySettings = {
      minimumCustodyTrustScore: 0,
      lowScoreThreshold: 50,
      lowScoreDepositMultiplier: '1.0000000000000001',
      manualReviewThreshold: 0,
      newAccountAgeDays: 0,
      newAccountRequestCap24h: 0,
    };
    const decision = evaluateTrustPolicy(policy, {
      requestType: 'CUSTODY',
      trustScore: 25,
      accountCreatedAt: new Date('2025-01-01T00:00:00Z'),
      now: new Date('2026-01-01T00:00:00Z'),
      priorRequestTimes: [],
    });
    const result = calculateFeeBreakdown(
      1,
      {
        dailyRateMinor: 0,
        serviceFeePercentage: '0',
        baseDepositMinor: 5_000_000_000_000_001,
      },
      decision.depositMultiplier,
    );
    expect(result.depositMultiplier).toBe('1.0000000000000001');
    expect(result.depositMinor).toBe(5_000_000_000_000_002);
  });

  it('supports zero rates, zero fees and zero deposits, and the largest safe total', () => {
    expect(
      calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: 0,
          serviceFeePercentage: '0',
          baseDepositMinor: 0,
        },
        '1',
      ).totalMinor,
    ).toBe(0);
    expect(
      calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: Number.MAX_SAFE_INTEGER,
          serviceFeePercentage: '0',
          baseDepositMinor: 0,
        },
        '1',
      ).totalMinor,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid nights %s',
    (nights) =>
      expect(() => calculateFeeBreakdown(nights, pricing, '1')).toThrow(),
  );

  it.each([
    ['dailyRateMinor', -1],
    ['dailyRateMinor', 0.5],
    ['dailyRateMinor', NaN],
    ['dailyRateMinor', Infinity],
    ['dailyRateMinor', Number.MAX_SAFE_INTEGER + 1],
    ['dailyRateMinor', undefined],
    ['baseDepositMinor', -1],
    ['baseDepositMinor', 0.5],
    ['baseDepositMinor', NaN],
    ['baseDepositMinor', Infinity],
    ['baseDepositMinor', Number.MAX_SAFE_INTEGER + 1],
    ['baseDepositMinor', undefined],
    ['serviceFeePercentage', undefined],
    ['serviceFeePercentage', 5],
    ['serviceFeePercentage', 'NaN'],
    ['serviceFeePercentage', 'Infinity'],
    ['serviceFeePercentage', '-1'],
    ['serviceFeePercentage', '100.0001'],
    ['serviceFeePercentage', '1e-3'],
    ['serviceFeePercentage', '0.0000000000000000001'],
  ])('rejects invalid approved pricing %s = %s', (field, value) => {
    expect(() =>
      calculateFeeBreakdown(1, { ...pricing, [field]: value }, '1'),
    ).toThrow();
  });

  it.each([
    '',
    'NaN',
    'Infinity',
    '0',
    '-1',
    '100.1',
    '1e0',
    '1.0000000000000000001',
  ])('rejects invalid multiplier %s', (multiplier) =>
    expect(() => calculateFeeBreakdown(1, pricing, multiplier)).toThrow(),
  );

  it('requires the approved pricing object and policy multiplier', () => {
    expect(() =>
      calculateFeeBreakdown(1, undefined as unknown as ApprovedFeePricing, '1'),
    ).toThrow();
    expect(() =>
      calculateFeeBreakdown(1, pricing, undefined as unknown as string),
    ).toThrow();
  });

  it('rejects overflow at the subtotal, deposit and total, not just individual inputs', () => {
    expect(() =>
      calculateFeeBreakdown(
        2,
        {
          dailyRateMinor: Number.MAX_SAFE_INTEGER,
          serviceFeePercentage: '0',
          baseDepositMinor: 0,
        },
        '1',
      ),
    ).toThrow(/subtotalMinor/);
    expect(() =>
      calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: 0,
          serviceFeePercentage: '0',
          baseDepositMinor: Number.MAX_SAFE_INTEGER,
        },
        '2',
      ),
    ).toThrow(/depositMinor/);
    expect(() =>
      calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: Number.MAX_SAFE_INTEGER,
          serviceFeePercentage: '0',
          baseDepositMinor: 1,
        },
        '1',
      ),
    ).toThrow(/totalMinor/);
    expect(() =>
      calculateFeeBreakdown(
        1,
        {
          dailyRateMinor: Number.MAX_SAFE_INTEGER,
          serviceFeePercentage: '100',
          baseDepositMinor: 0,
        },
        '1',
      ),
    ).toThrow(/totalMinor/);
  });
});
