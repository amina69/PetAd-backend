import { BadRequestException } from '@nestjs/common';

/**
 * Money helpers for the payments module.
 *
 * Every amount in this module is an integer number of minor units held in a
 * `bigint`. Floating point is never used: the helpers below perform exact
 * integer arithmetic and rounding so totals always reconcile.
 */

export const BPS_DENOMINATOR = 10_000n;

/**
 * Currencies we know how to render. Unknown currencies default to 2 decimals
 * (the most common ISO-4217 minor-unit size).
 */
const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  XLM: 7, // stroops
  USD: 2,
  EUR: 2,
  GBP: 2,
  NGN: 2,
};

export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * Parse a caller-supplied amount into minor units.
 *
 * Only non-negative integer strings are accepted — JSON numbers are rejected
 * because they could carry a fractional component and silently lose money.
 */
export function parseMinorUnits(value: string | bigint): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new BadRequestException('amountMinor cannot be negative');
    }
    return value;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new BadRequestException(
      'amountMinor must be a non-negative integer string expressed in minor units',
    );
  }

  return BigInt(trimmed);
}

/**
 * Multiply an amount by a basis-point rate, rounding half up.
 *
 * Integer-only: `(amount * bps + 5000) / 10000`.
 */
export function multiplyBpsRoundHalfUp(
  amountMinor: bigint,
  bps: number,
): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new RangeError('bps must be an integer between 0 and 10000');
  }
  if (amountMinor < 0n) {
    throw new RangeError('amountMinor cannot be negative');
  }

  return (amountMinor * BigInt(bps) + BPS_DENOMINATOR / 2n) / BPS_DENOMINATOR;
}

/**
 * Render an integer minor-unit amount as a human-readable decimal string.
 *
 * Uses only bigint division/remainder, so it is safe for values beyond
 * `Number.MAX_SAFE_INTEGER`.
 */
export function formatMinorUnits(
  amountMinor: bigint,
  currency: string,
): string {
  const decimals = currencyDecimals(currency);
  const unit = 10n ** BigInt(decimals);
  const whole = amountMinor / unit;
  const fraction = (amountMinor % unit).toString().padStart(decimals, '0');
  return decimals > 0 ? `${whole}.${fraction}` : `${whole}`;
}

/** True when the value is a JavaScript number (i.e. floating-point capable). */
export function isFloatingPointNumber(value: unknown): boolean {
  return typeof value === 'number';
}
