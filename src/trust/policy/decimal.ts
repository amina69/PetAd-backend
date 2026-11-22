import { Decimal } from '@prisma/client/runtime/client';

// Isolate monetary arithmetic from changes to Prisma's global Decimal settings.
// 64 significant digits covers a product of two safe integers and the accepted
// decimal inputs, without rounding before the explicit minor-unit rounding.
export const ExactDecimal = Decimal.clone({
  precision: 64,
  rounding: Decimal.ROUND_HALF_UP,
});

// These are representation/safety limits, not business-policy defaults.
const MAX_DECIMAL_LENGTH = 40;
const MAX_FRACTION_DIGITS = 18;
export const MAX_DEPOSIT_MULTIPLIER = 100;

/** Parse a non-negative, non-exponential decimal string without binary floats. */
export function parseDecimal(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): Decimal {
  if (typeof value !== 'string' || value.length > MAX_DECIMAL_LENGTH) {
    throw new RangeError(`${name} must be a bounded decimal string`);
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > MAX_FRACTION_DIGITS) {
    throw new RangeError(
      `${name} must be a non-negative decimal with at most ${MAX_FRACTION_DIGITS} fractional digits`,
    );
  }
  const decimal = new ExactDecimal(value);
  if (!decimal.isFinite() || decimal.lt(minimum) || decimal.gt(maximum)) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return decimal;
}

/** Multipliers can leave a deposit unchanged but can never reduce it. */
export function parseDepositMultiplier(value: string): Decimal {
  return parseDecimal(value, 'depositMultiplier', 1, MAX_DEPOSIT_MULTIPLIER);
}

export function assertSafeIntegerInRange(
  value: number,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be a safe integer from ${minimum} to ${maximum}`,
    );
  }
}
