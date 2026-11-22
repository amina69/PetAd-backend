import { Decimal } from '@prisma/client/runtime/client';
import {
  assertSafeIntegerInRange,
  ExactDecimal,
  parseDecimal,
  parseDepositMultiplier,
} from './decimal';

/**
 * Supply these values exclusively from trusted, server-approved pricing, never
 * from the request body. Percentage is a decimal percentage (e.g. '7.5' for
 * 7.5%), not a fraction. All minor-unit amounts are integer USD cents.
 */
export interface ApprovedFeePricing {
  dailyRateMinor: number;
  serviceFeePercentage: string;
  baseDepositMinor: number;
}

export interface FeeBreakdown {
  nights: number;
  dailyRateMinor: number;
  subtotalMinor: number;
  serviceFeeMinor: number;
  baseDepositMinor: number;
  depositMultiplier: string;
  depositMinor: number;
  totalMinor: number;
  currency: 'USD';
}

function toSafeMinor(value: Decimal, name: string): number {
  if (
    !value.isFinite() ||
    !value.isInteger() ||
    value.isNegative() ||
    value.gt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError(`${name} exceeds the safe integer minor-unit range`);
  }
  return value.toNumber();
}

/**
 * Calculate a server-owned quote. Pass the policy decision's multiplier and
 * approved pricing separately from the request. Service fee is charged on the
 * subtotal only; the refundable deposit is not included in the fee base.
 * Each fee/deposit line is rounded independently to cents, half up, before
 * summing. Any invalid input or unsafe result throws instead of returning NaN
 * or a silently rounded JavaScript integer.
 */
export function calculateFeeBreakdown(
  nights: number,
  approvedPricing: ApprovedFeePricing,
  depositMultiplier: string,
): FeeBreakdown {
  assertSafeIntegerInRange(nights, 'nights', 1);
  if (!approvedPricing || typeof approvedPricing !== 'object') {
    throw new TypeError('Approved pricing is required');
  }
  assertSafeIntegerInRange(approvedPricing.dailyRateMinor, 'dailyRateMinor', 0);
  assertSafeIntegerInRange(
    approvedPricing.baseDepositMinor,
    'baseDepositMinor',
    0,
  );
  const percentage = parseDecimal(
    approvedPricing.serviceFeePercentage,
    'serviceFeePercentage',
    0,
    100,
  );
  const multiplier = parseDepositMultiplier(depositMultiplier);

  const subtotal = new ExactDecimal(approvedPricing.dailyRateMinor).times(
    nights,
  );
  const subtotalMinor = toSafeMinor(subtotal, 'subtotalMinor');
  const serviceFee = subtotal
    .times(percentage)
    .dividedBy(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const serviceFeeMinor = toSafeMinor(serviceFee, 'serviceFeeMinor');
  const deposit = new ExactDecimal(approvedPricing.baseDepositMinor)
    .times(multiplier)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const depositMinor = toSafeMinor(deposit, 'depositMinor');
  const totalMinor = toSafeMinor(
    subtotal.plus(serviceFee).plus(deposit),
    'totalMinor',
  );

  return {
    nights,
    dailyRateMinor: approvedPricing.dailyRateMinor,
    subtotalMinor,
    serviceFeeMinor,
    baseDepositMinor: approvedPricing.baseDepositMinor,
    depositMultiplier: multiplier.toFixed(),
    depositMinor,
    totalMinor,
    currency: 'USD',
  };
}
