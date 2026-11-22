export const SUPPORTED_CURRENCY_PAIRS = Object.freeze([
  Object.freeze({ asset: 'XLM', currency: 'USD' } as const),
] as const);

export type CurrencyPair = (typeof SUPPORTED_CURRENCY_PAIRS)[number];

/** USD per one XLM. The timestamp is the provider's observation time, not fetch time. */
export interface ExchangeRate extends CurrencyPair {
  readonly rateUsdPerXlm: string;
  readonly source: string;
  /** UTC ISO-8601, with up to nine fractional second digits. */
  readonly sourceTimestamp: string;
}

export interface RateProvider {
  getRate(pair: CurrencyPair): Promise<ExchangeRate>;
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface CurrencyOptions {
  readonly clock?: Clock;
  /** After this age a cached value is refreshed, even if it can still be used as fallback. */
  readonly refreshAfterMs?: number;
  /** Maximum time since a successful fetch for either normal use or fallback. */
  readonly maxCacheAgeMs?: number;
  /** Hard limit measured from the provider's actual observation timestamp. */
  readonly maxSourceAgeMs?: number;
}

/** A display estimate, not a guarantee that a future payment will execute. */
export interface QuoteEstimate extends CurrencyPair {
  readonly kind: 'estimate';
  readonly fixedSide: 'fiat' | 'settlement';
  readonly estimatedFiatCents: number;
  readonly estimatedSettlementAmount: string;
  readonly rateUsdPerXlm: string;
  readonly rateSource: string;
  readonly rateSourceTimestamp: string;
  readonly estimatedAt: string;
  /** The estimate is usable through this timestamp, inclusive. */
  readonly expiresAt: string;
}

/** Persist these immutable terms at agreement time; do not replace them with a current rate. */
export interface SettlementSnapshot extends CurrencyPair {
  readonly rateUsdPerXlm: string;
  readonly rateSource: string;
  readonly rateSourceTimestamp: string;
  readonly settlementAmount: string;
  readonly fiatCents: number;
}

/** Totals already refunded under the same snapshot, supplied by the caller's ledger. */
export interface RefundedTotals {
  readonly fiatCents: number;
  readonly settlementAmount: string;
}

export interface RefundCalculation extends CurrencyPair {
  readonly fiatCents: number;
  readonly settlementAmount: string;
}

export type CurrencyErrorCode =
  | 'INVALID_OPTIONS'
  | 'INVALID_CLOCK'
  | 'INVALID_AMOUNT'
  | 'INVALID_RATE'
  | 'INVALID_TIMESTAMP'
  | 'STALE_RATE'
  | 'RATE_UNAVAILABLE'
  | 'UNSUPPORTED_PAIR'
  | 'EXPIRED_QUOTE'
  | 'INVALID_QUOTE'
  | 'INVALID_SNAPSHOT';

export class CurrencyError extends Error {
  constructor(
    readonly code: CurrencyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CurrencyError';
  }
}
