import {
  Clock,
  CoinbaseRateProvider,
  CurrencyError,
  CurrencyPair,
  CurrencyService,
  ExchangeRate,
  FakeRateProvider,
  QuoteEstimate,
  RateProvider,
  SUPPORTED_CURRENCY_PAIRS,
  calculateRefund,
} from './index';

const START = Date.parse('2026-01-01T00:00:00.000Z');

class FakeClock implements Clock {
  constructor(private time = START) {}
  now(): Date {
    return new Date(this.time);
  }
  advance(ms: number): void {
    this.time += ms;
  }
  iso(): string {
    return this.now().toISOString();
  }
}

function rate(price = '0.5', timestamp = new Date(START).toISOString()): ExchangeRate {
  return {
    asset: 'XLM',
    currency: 'USD',
    rateUsdPerXlm: price,
    source: 'test-market',
    sourceTimestamp: timestamp,
  };
}

function setup(price = '0.5') {
  const clock = new FakeClock();
  const provider = new FakeRateProvider(rate(price));
  const currency = new CurrencyService(provider, {
    clock,
    refreshAfterMs: 1_000,
    maxCacheAgeMs: 5_000,
    maxSourceAgeMs: 6_000,
  });
  return { clock, provider, currency };
}

function code(errorCode: string) {
  return expect.objectContaining({ code: errorCode });
}

describe('currency estimates and snapshots', () => {
  it('exposes only XLM/USD and preserves precise rate and immutable terms', async () => {
    expect(SUPPORTED_CURRENCY_PAIRS).toEqual([{ asset: 'XLM', currency: 'USD' }]);
    const { currency } = setup('0.123456789123456789');
    const quote = await currency.quoteForFiat(100);
    expect(quote).toMatchObject({
      kind: 'estimate',
      fixedSide: 'fiat',
      asset: 'XLM',
      currency: 'USD',
      estimatedFiatCents: 100,
      estimatedSettlementAmount: '8.1000001',
      rateUsdPerXlm: '0.123456789123456789',
      rateSource: 'test-market',
      rateSourceTimestamp: '2026-01-01T00:00:00.000Z',
      estimatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:00:05.000Z',
    });
    const snapshot = currency.lockQuote(quote);
    expect(snapshot).toEqual({
      asset: 'XLM',
      currency: 'USD',
      fiatCents: 100,
      settlementAmount: '8.1000001',
      rateUsdPerXlm: '0.123456789123456789',
      rateSource: 'test-market',
      rateSourceTimestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('uses half-up rounding in both directions, including exact ties', async () => {
    const fiat = setup('0.3');
    expect((await fiat.currency.quoteForFiat(2)).estimatedSettlementAmount).toBe('0.0666667');
    const xlm = setup('1');
    expect((await xlm.currency.quoteForSettlement('0.005')).estimatedFiatCents).toBe(1);
    expect((await xlm.currency.quoteForSettlement('0.0149999')).estimatedFiatCents).toBe(1);
    const quote = await xlm.currency.quoteForSettlement('0.015');
    expect(quote).toMatchObject({
      fixedSide: 'settlement',
      estimatedFiatCents: 2,
      estimatedSettlementAmount: '0.0150000',
    });
    expect(xlm.currency.lockQuote(quote).fiatCents).toBe(2);
  });

  it('distinguishes values immediately above, at, and below half a stroop', async () => {
    expect((await setup('199999.999999999999999999').currency.quoteForFiat(1)).estimatedSettlementAmount).toBe('0.0000001');
    expect((await setup('200000').currency.quoteForFiat(1)).estimatedSettlementAmount).toBe('0.0000001');
    await expect(setup('200000.000000000000000001').currency.quoteForFiat(1)).rejects.toMatchObject(code('INVALID_AMOUNT'));
  });

  it('distinguishes a half-cent from just below it without floats', async () => {
    expect((await setup('50000').currency.quoteForSettlement('0.0000001')).estimatedFiatCents).toBe(1);
    await expect(setup('49999.999999999999999999').currency.quoteForSettlement('0.0000001')).rejects.toMatchObject(code('INVALID_AMOUNT'));
  });

  it('enforces Stellar int64, seven decimal places, safe integer cents and nonzero amounts', async () => {
    const { currency } = setup('0.01');
    const quote = await currency.quoteForSettlement('922337203685.4775807');
    expect(quote.estimatedSettlementAmount).toBe('922337203685.4775807');
    expect(quote.estimatedFiatCents).toBe(922337203685);
    expect(calculateRefund(currency.lockQuote(quote), quote.estimatedFiatCents).settlementAmount).toBe('922337203685.4775807');
    for (const invalid of ['0', '-1', '1.00000001', '922337203685.4775808', '1e-7', '01']) {
      await expect(currency.quoteForSettlement(invalid)).rejects.toMatchObject(code('INVALID_AMOUNT'));
    }
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      await expect(currency.quoteForFiat(invalid)).rejects.toMatchObject(code('INVALID_AMOUNT'));
    }
    await expect(setup('1000').currency.quoteForSettlement('922337203685.4775807')).rejects.toMatchObject(code('INVALID_AMOUNT'));
  });

  it('locks only unexpired, internally consistent quotes, including the exact expiry boundary', async () => {
    const { clock, currency } = setup('0.5');
    const quote = await currency.quoteForFiat(100);
    expect(() => currency.lockQuote({ ...quote, estimatedSettlementAmount: '3.0000000' })).toThrow(code('INVALID_QUOTE'));
    expect(() => currency.lockQuote({ ...quote, estimatedAt: '2026-01-01T00:00:01.000Z' })).toThrow(code('INVALID_QUOTE'));
    expect(() => currency.lockQuote({ ...quote, expiresAt: '2026-01-01T00:01:00.000Z' })).toThrow(code('INVALID_QUOTE'));
    clock.advance(5_000);
    expect(currency.lockQuote(quote).settlementAmount).toBe('2.0000000');
    clock.advance(1);
    expect(() => currency.lockQuote(quote)).toThrow(code('EXPIRED_QUOTE'));
  });
});

describe('rate validation, cache and recovery', () => {
  it.each(['0', '-1', 'NaN', 'Infinity', '1e-7', '0.0000000000000000001', '1.1234567890123456789', '01'])('rejects invalid rate %s', async (price) => {
    await expect(setup(price).currency.quoteForFiat(100)).rejects.toMatchObject(code('INVALID_RATE'));
  });

  it.each(['2026-02-30T00:00:00Z', '2026-01-01T00:00:00', 'not-a-date', '2026-01-01T00:00:00.0000000001Z'])('rejects invalid timestamp %s', async (timestamp) => {
    const clock = new FakeClock();
    const currency = new CurrencyService(new FakeRateProvider(rate('1', timestamp)), { clock });
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('INVALID_TIMESTAMP'));
  });

  it('rejects future timestamps even by a single nanosecond', async () => {
    const clock = new FakeClock();
    const currency = new CurrencyService(new FakeRateProvider(rate('1', '2026-01-01T00:00:00.000000001Z')), { clock });
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('INVALID_TIMESTAMP'));
  });

  it('enforces the provider source age at the exact boundary', async () => {
    const clock = new FakeClock();
    const provider = new FakeRateProvider(rate('1', new Date(START - 6_000).toISOString()));
    const currency = new CurrencyService(provider, { clock, maxSourceAgeMs: 6_000 });
    const quote = await currency.quoteForFiat(100);
    expect(quote.expiresAt).toBe(clock.iso());
    expect(currency.lockQuote(quote).settlementAmount).toBe('1.0000000');
    clock.advance(1);
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('STALE_RATE'));
    expect(() => currency.lockQuote(quote)).toThrow(code('EXPIRED_QUOTE'));
  });

  it('uses a fresh fallback after refresh failure without extending its life', async () => {
    const { clock, provider, currency } = setup();
    const initial = await currency.quoteForFiat(100);
    await currency.quoteForFiat(100);
    expect(provider.calls).toBe(1);
    provider.failWith(new Error('offline'));
    clock.advance(1_000);
    const fallback = await currency.quoteForFiat(100);
    expect(fallback.estimatedSettlementAmount).toBe('2.0000000');
    expect(fallback.expiresAt).toBe(initial.expiresAt);
    expect(provider.calls).toBe(2);
    clock.advance(4_000);
    expect((await currency.quoteForFiat(100)).estimatedSettlementAmount).toBe('2.0000000');
    clock.advance(1);
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('RATE_UNAVAILABLE'));
  });

  it('never falls back beyond the hard source age even when cache age is fresh', async () => {
    const clock = new FakeClock();
    const provider = new FakeRateProvider(rate('1', new Date(START - 4_500).toISOString()));
    const currency = new CurrencyService(provider, { clock, refreshAfterMs: 100, maxCacheAgeMs: 10_000, maxSourceAgeMs: 5_000 });
    await currency.quoteForFiat(100);
    provider.failWith(new Error('offline'));
    clock.advance(500);
    expect((await currency.quoteForFiat(100)).expiresAt).toBe(clock.iso());
    clock.advance(1);
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('RATE_UNAVAILABLE'));
  });

  it('uses only valid cached data for an invalid or future refresh and recovers later', async () => {
    const { clock, provider, currency } = setup();
    await currency.quoteForFiat(100);
    clock.advance(1_000);
    provider.setRate(rate('2', '2026-01-01T00:00:02.000Z'));
    expect((await currency.quoteForFiat(100)).rateUsdPerXlm).toBe('0.5');
    clock.advance(5_001);
    provider.setRate(rate('2', '2026-01-01T00:00:07.000Z'));
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('INVALID_TIMESTAMP'));
    provider.setRate(rate('2', clock.iso()));
    expect((await currency.quoteForFiat(100)).estimatedSettlementAmount).toBe('0.5000000');
  });

  it('recovers from a provider outage after both fallback limits expire', async () => {
    const { clock, provider, currency } = setup();
    await currency.quoteForFiat(100);
    provider.failWith(new Error('offline'));
    clock.advance(6_001);
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('RATE_UNAVAILABLE'));
    provider.setRate(rate('2', clock.iso()));
    provider.failWith(null);
    expect((await currency.quoteForFiat(100)).estimatedSettlementAmount).toBe('0.5000000');
  });

  it('rejects a source timestamp that moves backwards rather than regressing a cache', async () => {
    const { clock, provider, currency } = setup();
    await currency.quoteForFiat(100);
    clock.advance(1_000);
    provider.setRate(rate('2', new Date(START - 1).toISOString()));
    expect((await currency.quoteForFiat(100)).rateUsdPerXlm).toBe('0.5');
    clock.advance(4_001);
    await expect(currency.quoteForFiat(100)).rejects.toMatchObject(code('INVALID_TIMESTAMP'));
  });

  it('coalesces concurrent refreshes', async () => {
    const clock = new FakeClock();
    let resolveRate!: (value: ExchangeRate) => void;
    const getRate = jest.fn(() => new Promise<ExchangeRate>((resolve) => { resolveRate = resolve; }));
    const currency = new CurrencyService({ getRate }, { clock });
    const first = currency.quoteForFiat(100);
    const second = currency.quoteForFiat(200);
    expect(getRate).toHaveBeenCalledTimes(1);
    resolveRate(rate());
    expect((await first).estimatedSettlementAmount).toBe('2.0000000');
    expect((await second).estimatedSettlementAmount).toBe('4.0000000');
  });

  it('validates source, pair, clock and configuration', async () => {
    const clock = new FakeClock();
    const invalid = { ...rate(), source: '   ' };
    await expect(new CurrencyService(new FakeRateProvider(invalid), { clock }).quoteForFiat(100)).rejects.toMatchObject(code('INVALID_RATE'));
    const wrongPair = { ...rate(), asset: 'BTC' } as unknown as ExchangeRate;
    await expect(new CurrencyService(new FakeRateProvider(wrongPair), { clock }).quoteForFiat(100)).rejects.toMatchObject(code('UNSUPPORTED_PAIR'));
    await expect(new CurrencyService(new FakeRateProvider(rate()), { clock: { now: () => new Date(NaN) } }).quoteForFiat(100)).rejects.toMatchObject(code('INVALID_CLOCK'));
    expect(() => new CurrencyService(new FakeRateProvider(rate()), { refreshAfterMs: 2, maxCacheAgeMs: 1 })).toThrow(code('INVALID_OPTIONS'));
  });
});

describe('snapshot refunds', () => {
  it('uses the original snapshot after the market rate changes', async () => {
    const { clock, provider, currency } = setup('0.5');
    const snapshot = currency.lockQuote(await currency.quoteForFiat(100));
    clock.advance(1_000);
    provider.setRate(rate('2', clock.iso()));
    expect((await currency.quoteForFiat(100)).estimatedSettlementAmount).toBe('0.5000000');
    expect(calculateRefund(snapshot, 100)).toEqual({ asset: 'XLM', currency: 'USD', fiatCents: 100, settlementAmount: '2.0000000' });
    expect(calculateRefund(snapshot, 25).settlementAmount).toBe('0.5000000');
  });

  it('rounds partial refunds half-up and pays all remaining stroops on the final refund', async () => {
    const { currency } = setup('0.03');
    const snapshot = currency.lockQuote(await currency.quoteForFiat(100));
    expect(snapshot.settlementAmount).toBe('33.3333333');
    const first = calculateRefund(snapshot, 33);
    expect(first.settlementAmount).toBe('11.0000000');
    const second = calculateRefund(snapshot, 33, first);
    expect(second.settlementAmount).toBe('11.0000000');
    const last = calculateRefund(snapshot, 34, { fiatCents: 66, settlementAmount: '22.0000000' });
    expect(last.settlementAmount).toBe('11.3333333');
    expect(Object.isFrozen(last)).toBe(true);
  });

  it('rejects invalid snapshots, excess cumulative refunds and unrepresentable refunds', async () => {
    const { currency } = setup('0.5');
    const snapshot = currency.lockQuote(await currency.quoteForFiat(100));
    expect(() => calculateRefund({ ...snapshot, settlementAmount: '50' }, 50)).toThrow(code('INVALID_SNAPSHOT'));
    expect(() => calculateRefund(snapshot, 0)).toThrow(code('INVALID_AMOUNT'));
    expect(() => calculateRefund(snapshot, 101)).toThrow(code('INVALID_AMOUNT'));
    expect(() => calculateRefund(snapshot, 11, { fiatCents: 90, settlementAmount: '1.8000000' })).toThrow(code('INVALID_AMOUNT'));
    expect(() => calculateRefund(snapshot, 1, { fiatCents: 1, settlementAmount: '2.0000001' })).toThrow(code('INVALID_AMOUNT'));
    const tiny = setup('200000');
    const oneStroop = tiny.currency.lockQuote(await tiny.currency.quoteForFiat(1));
    expect(calculateRefund(oneStroop, 1).settlementAmount).toBe('0.0000001');
  });
});

describe('Coinbase public ticker adapter', () => {
  it('requests the XLM-USD ticker and retains string price and nanosecond trade time', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ price: '0.128129', time: '2026-01-01T00:00:00.123456789Z', trade_id: 123 }), { status: 200 }));
    const provider = new CoinbaseRateProvider(fetcher);
    expect(await provider.getRate(SUPPORTED_CURRENCY_PAIRS[0])).toEqual({ asset: 'XLM', currency: 'USD', rateUsdPerXlm: '0.128129', source: 'coinbase-exchange', sourceTimestamp: '2026-01-01T00:00:00.123456789Z' });
    expect(fetcher).toHaveBeenCalledWith('https://api.exchange.coinbase.com/products/XLM-USD/ticker', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('rejects HTTP errors, non-string prices, missing timestamps and other pairs', async () => {
    const response = (body: unknown, status = 200) => jest.fn(async () => new Response(JSON.stringify(body), { status }));
    await expect(new CoinbaseRateProvider(response({}, 503)).getRate(SUPPORTED_CURRENCY_PAIRS[0])).rejects.toMatchObject(code('RATE_UNAVAILABLE'));
    await expect(new CoinbaseRateProvider(response({ price: 0.1, time: '2026-01-01T00:00:00Z' })).getRate(SUPPORTED_CURRENCY_PAIRS[0])).rejects.toMatchObject(code('INVALID_RATE'));
    await expect(new CoinbaseRateProvider(response({ price: '0.1' })).getRate(SUPPORTED_CURRENCY_PAIRS[0])).rejects.toMatchObject(code('INVALID_TIMESTAMP'));
    await expect(new CoinbaseRateProvider(response({})).getRate({ asset: 'BTC', currency: 'USD' } as unknown as CurrencyPair)).rejects.toMatchObject(code('UNSUPPORTED_PAIR'));
  });
});
