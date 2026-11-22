import {
  assertCents,
  centsForStellar,
  clockMillis,
  millisToNanos,
  nanosToIsoFloor,
  rateDecimal,
  stellarDecimal,
  stellarForCents,
  timestampNanos,
} from './currency.math';
import {
  Clock,
  CurrencyError,
  CurrencyOptions,
  ExchangeRate,
  QuoteEstimate,
  RateProvider,
  SettlementSnapshot,
  SUPPORTED_CURRENCY_PAIRS,
  SystemClock,
} from './currency.types';

interface CachedRate {
  readonly rate: ExchangeRate;
  readonly sourceNanos: bigint;
  readonly fetchedAtMs: number;
}

/** Independent of Nest and persistence; create one instance per cache/policy. */
export class CurrencyService {
  private readonly clock: Clock;
  private readonly refreshAfterMs: number;
  private readonly maxCacheAgeMs: number;
  private readonly maxSourceAgeMs: number;
  private cache?: CachedRate;
  private refreshInFlight?: Promise<CachedRate>;

  constructor(
    private readonly provider: RateProvider,
    options: CurrencyOptions = {},
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.refreshAfterMs = options.refreshAfterMs ?? 30_000;
    this.maxCacheAgeMs = options.maxCacheAgeMs ?? 120_000;
    this.maxSourceAgeMs = options.maxSourceAgeMs ?? 300_000;
    if (
      !Number.isSafeInteger(this.refreshAfterMs) ||
      this.refreshAfterMs < 0 ||
      !Number.isSafeInteger(this.maxCacheAgeMs) ||
      this.maxCacheAgeMs <= 0 ||
      !Number.isSafeInteger(this.maxSourceAgeMs) ||
      this.maxSourceAgeMs <= 0 ||
      this.refreshAfterMs > this.maxCacheAgeMs
    ) {
      throw new CurrencyError('INVALID_OPTIONS', 'Invalid cache or source age policy');
    }
  }

  /** Estimate XLM for a fixed positive integer number of USD cents. */
  async quoteForFiat(fiatCents: number): Promise<QuoteEstimate> {
    assertCents(fiatCents);
    return this.makeQuote('fiat', fiatCents);
  }

  /** Estimate USD cents for a fixed Stellar XLM amount. */
  async quoteForSettlement(settlementAmount: string): Promise<QuoteEstimate> {
    const amount = stellarDecimal(settlementAmount).toFixed(7);
    return this.makeQuote('settlement', amount);
  }

  /**
   * Capture the quoted terms at agreement time. Quotes must be kept server-side
   * or authenticated by the caller: validation here is not a signature or a
   * persistence mechanism. This method never refreshes or changes quoted terms.
   */
  lockQuote(quote: QuoteEstimate): SettlementSnapshot {
    const nowNanos = millisToNanos(clockMillis(this.clock));
    if (
      !quote ||
      quote.kind !== 'estimate' ||
      quote.asset !== 'XLM' ||
      quote.currency !== 'USD' ||
      (quote.fixedSide !== 'fiat' && quote.fixedSide !== 'settlement') ||
      typeof quote.rateSource !== 'string' ||
      quote.rateSource.trim() !== quote.rateSource ||
      !quote.rateSource
    ) {
      throw new CurrencyError('INVALID_QUOTE', 'Invalid quote fields');
    }

    let sourceNanos: bigint;
    let estimatedNanos: bigint;
    let expiryNanos: bigint;
    try {
      sourceNanos = timestampNanos(quote.rateSourceTimestamp);
      estimatedNanos = timestampNanos(quote.estimatedAt);
      expiryNanos = timestampNanos(quote.expiresAt);
      const rate = rateDecimal(quote.rateUsdPerXlm);
      assertCents(quote.estimatedFiatCents);
      const amount = stellarDecimal(quote.estimatedSettlementAmount);
      if (
        amount.toFixed(7) !== quote.estimatedSettlementAmount ||
        (quote.fixedSide === 'fiat' &&
          stellarForCents(quote.estimatedFiatCents, rate) !== quote.estimatedSettlementAmount) ||
        (quote.fixedSide === 'settlement' &&
          centsForStellar(amount, rate) !== quote.estimatedFiatCents)
      ) {
        throw new Error('Quote amounts do not match the rate');
      }
    } catch (error) {
      throw new CurrencyError('INVALID_QUOTE', 'Invalid quote terms', { cause: error });
    }

    if (
      sourceNanos > estimatedNanos ||
      estimatedNanos > nowNanos ||
      expiryNanos < estimatedNanos ||
      expiryNanos > sourceNanos + millisToNanos(this.maxSourceAgeMs) ||
      expiryNanos > estimatedNanos + millisToNanos(this.maxCacheAgeMs)
    ) {
      throw new CurrencyError('INVALID_QUOTE', 'Invalid quote timing');
    }
    if (nowNanos > expiryNanos) {
      throw new CurrencyError('EXPIRED_QUOTE', 'Quote has expired');
    }

    return Object.freeze({
      asset: 'XLM',
      currency: 'USD',
      rateUsdPerXlm: quote.rateUsdPerXlm,
      rateSource: quote.rateSource,
      rateSourceTimestamp: quote.rateSourceTimestamp,
      settlementAmount: quote.estimatedSettlementAmount,
      fiatCents: quote.estimatedFiatCents,
    });
  }

  private async makeQuote(
    fixedSide: 'fiat' | 'settlement',
    fixedAmount: number | string,
  ): Promise<QuoteEstimate> {
    const cached = await this.getRate();
    const now = clockMillis(this.clock);
    if (!this.isUsable(cached, now)) {
      throw new CurrencyError('STALE_RATE', 'Rate expired before the quote was created');
    }
    const rate = rateDecimal(cached.rate.rateUsdPerXlm);
    const fiatCents =
      fixedSide === 'fiat'
        ? (fixedAmount as number)
        : centsForStellar(stellarDecimal(fixedAmount), rate);
    const settlementAmount =
      fixedSide === 'settlement'
        ? (fixedAmount as string)
        : stellarForCents(fiatCents, rate);
    const cacheExpiry = millisToNanos(cached.fetchedAtMs) + millisToNanos(this.maxCacheAgeMs);
    const sourceExpiry = cached.sourceNanos + millisToNanos(this.maxSourceAgeMs);
    const maxDate = millisToNanos(8_640_000_000_000_000);
    const expiry = [cacheExpiry, sourceExpiry, maxDate].reduce((a, b) => (a < b ? a : b));

    return Object.freeze({
      kind: 'estimate',
      asset: 'XLM',
      currency: 'USD',
      fixedSide,
      estimatedFiatCents: fiatCents,
      estimatedSettlementAmount: settlementAmount,
      rateUsdPerXlm: cached.rate.rateUsdPerXlm,
      rateSource: cached.rate.source,
      rateSourceTimestamp: cached.rate.sourceTimestamp,
      estimatedAt: new Date(now).toISOString(),
      expiresAt: nanosToIsoFloor(expiry),
    });
  }

  private async getRate(): Promise<CachedRate> {
    const now = clockMillis(this.clock);
    if (
      this.cache &&
      this.isUsable(this.cache, now) &&
      now - this.cache.fetchedAtMs < this.refreshAfterMs
    ) {
      return this.cache;
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.fetchRate().finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    try {
      return await this.refreshInFlight;
    } catch (error) {
      // Failed/invalid refreshes never extend cache life or source freshness.
      const fallbackTime = clockMillis(this.clock);
      if (this.cache && this.isUsable(this.cache, fallbackTime)) {
        return this.cache;
      }
      if (error instanceof CurrencyError) throw error;
      throw new CurrencyError('RATE_UNAVAILABLE', 'Rate provider is unavailable', { cause: error });
    }
  }

  private async fetchRate(): Promise<CachedRate> {
    const result = await this.provider.getRate(SUPPORTED_CURRENCY_PAIRS[0]);
    if (!result || result.asset !== 'XLM' || result.currency !== 'USD') {
      throw new CurrencyError('UNSUPPORTED_PAIR', 'Only XLM/USD is supported');
    }
    const rate = rateDecimal(result.rateUsdPerXlm).toFixed();
    if (typeof result.source !== 'string' || !result.source.trim()) {
      throw new CurrencyError('INVALID_RATE', 'Rate source is required');
    }
    const sourceNanos = timestampNanos(result.sourceTimestamp);
    const fetchedAtMs = clockMillis(this.clock);
    const nowNanos = millisToNanos(fetchedAtMs);
    if (sourceNanos > nowNanos) {
      throw new CurrencyError('INVALID_TIMESTAMP', 'Rate timestamp is in the future');
    }
    if (nowNanos - sourceNanos > millisToNanos(this.maxSourceAgeMs)) {
      throw new CurrencyError('STALE_RATE', 'Provider rate is too old');
    }
    if (this.cache && sourceNanos < this.cache.sourceNanos) {
      throw new CurrencyError('INVALID_TIMESTAMP', 'Provider rate timestamp moved backwards');
    }
    const cached: CachedRate = {
      rate: Object.freeze({
        asset: 'XLM',
        currency: 'USD',
        rateUsdPerXlm: rate,
        source: result.source.trim(),
        sourceTimestamp: result.sourceTimestamp,
      }),
      sourceNanos,
      fetchedAtMs,
    };
    this.cache = cached;
    return cached;
  }

  private isUsable(cached: CachedRate, nowMs: number): boolean {
    const sourceAge = millisToNanos(nowMs) - cached.sourceNanos;
    const cacheAge = nowMs - cached.fetchedAtMs;
    return (
      cacheAge >= 0 &&
      cacheAge <= this.maxCacheAgeMs &&
      sourceAge >= 0n &&
      sourceAge <= millisToNanos(this.maxSourceAgeMs)
    );
  }
}
