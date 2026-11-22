import { Decimal } from '@prisma/client/runtime/client';
import { CurrencyError } from './currency.types';

// Clone Prisma's Decimal so application-wide Decimal settings cannot alter money math.
// The bounded inputs below fit comfortably within 100 significant digits, including
// intermediate division, before the one explicit half-up rounding operation.
const Money = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP });
const MAX_STELLAR_AMOUNT = new Money('922337203685.4775807');
const MAX_SAFE_CENTS = new Money(Number.MAX_SAFE_INTEGER.toString());
const RATE_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const STELLAR_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,7})?$/;
const NANOS_PER_MS = 1_000_000n;

export function rateDecimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !RATE_PATTERN.test(value)) {
    throw new CurrencyError('INVALID_RATE', 'Rate must be a bounded decimal string');
  }
  const rate = new Money(value);
  if (!rate.isPositive() || rate.isZero()) {
    throw new CurrencyError('INVALID_RATE', 'Rate must be positive');
  }
  return rate;
}

export function stellarDecimal(value: unknown, allowZero = false): Decimal {
  if (typeof value !== 'string' || !STELLAR_PATTERN.test(value)) {
    throw new CurrencyError(
      'INVALID_AMOUNT',
      'XLM must be a decimal string with at most seven fractional digits',
    );
  }
  const amount = new Money(value);
  if ((!allowZero && amount.isZero()) || amount.gt(MAX_STELLAR_AMOUNT)) {
    throw new CurrencyError('INVALID_AMOUNT', 'XLM amount is outside Stellar bounds');
  }
  return amount;
}

export function assertCents(value: unknown, allowZero = false): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1)
  ) {
    throw new CurrencyError('INVALID_AMOUNT', 'USD cents must be a safe positive integer');
  }
}

/** Fiat-fixed conversion: exactly one half-up rounding to Stellar's seven places. */
export function stellarForCents(cents: number, rate: Decimal): string {
  assertCents(cents);
  const amount = new Money(cents.toString())
    .div(100)
    .div(rate)
    .toDecimalPlaces(7, Decimal.ROUND_HALF_UP);
  return stellarDecimal(amount.toFixed(7)).toFixed(7);
}

/** XLM-fixed conversion: exactly one half-up rounding to integer USD cents. */
export function centsForStellar(amount: Decimal, rate: Decimal): number {
  const cents = amount.mul(rate).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (cents.isZero() || cents.gt(MAX_SAFE_CENTS)) {
    throw new CurrencyError('INVALID_AMOUNT', 'USD cents are outside supported bounds');
  }
  return cents.toNumber();
}

export function proportionalStellar(
  settlementAmount: Decimal,
  refundCents: number,
  totalCents: number,
): Decimal {
  return settlementAmount
    .mul(refundCents.toString())
    .div(totalCents.toString())
    .toDecimalPlaces(7, Decimal.ROUND_HALF_UP);
}

/** Parse UTC timestamps without truncating sub-millisecond provider timestamps. */
export function timestampNanos(value: unknown): bigint {
  if (typeof value !== 'string') {
    throw new CurrencyError('INVALID_TIMESTAMP', 'Timestamp must be a UTC ISO string');
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    value,
  );
  if (!match) {
    throw new CurrencyError('INVALID_TIMESTAMP', 'Timestamp must be a UTC ISO string');
  }
  const wholeSecond = `${match[1]}.000Z`;
  const date = new Date(wholeSecond);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== wholeSecond) {
    throw new CurrencyError('INVALID_TIMESTAMP', 'Timestamp is not a valid date');
  }
  return BigInt(date.getTime()) * NANOS_PER_MS + BigInt((match[2] ?? '').padEnd(9, '0'));
}

export function clockMillis(clock: { now(): Date }): number {
  const now = clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new CurrencyError('INVALID_CLOCK', 'Clock returned an invalid date');
  }
  return now.getTime();
}

export function millisToNanos(value: number): bigint {
  return BigInt(value) * NANOS_PER_MS;
}

/** Floor to milliseconds, ensuring the advertised expiry never exceeds the true limit. */
export function nanosToIsoFloor(value: bigint): string {
  // BigInt division truncates toward zero; adjust for pre-epoch timestamps.
  const millis = value >= 0n ? value / NANOS_PER_MS : (value - NANOS_PER_MS + 1n) / NANOS_PER_MS;
  const maxDateMillis = 8_640_000_000_000_000n;
  if (millis > maxDateMillis || millis < -maxDateMillis) {
    throw new CurrencyError('INVALID_TIMESTAMP', 'Timestamp is outside supported date bounds');
  }
  return new Date(Number(millis)).toISOString();
}
