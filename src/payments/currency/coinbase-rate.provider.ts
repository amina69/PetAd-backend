import { CurrencyError, CurrencyPair, ExchangeRate, RateProvider } from './currency.types';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Coinbase Exchange's public XLM-USD ticker: price is a string and time is the last trade time. */
export class CoinbaseRateProvider implements RateProvider {
  constructor(
    private readonly fetcher: FetchLike = globalThis.fetch,
    private readonly timeoutMs = 5_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 4_294_967_295) {
      throw new CurrencyError('INVALID_OPTIONS', 'Invalid Coinbase timeout');
    }
  }

  async getRate(pair: CurrencyPair): Promise<ExchangeRate> {
    if (!pair || pair.asset !== 'XLM' || pair.currency !== 'USD') {
      throw new CurrencyError('UNSUPPORTED_PAIR', 'Only XLM/USD is supported');
    }
    const response = await this.fetcher('https://api.exchange.coinbase.com/products/XLM-USD/ticker', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new CurrencyError('RATE_UNAVAILABLE', `Coinbase returned HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('price' in body) ||
      typeof body.price !== 'string'
    ) {
      throw new CurrencyError('INVALID_RATE', 'Coinbase ticker must contain a string price');
    }
    if (!('time' in body) || typeof body.time !== 'string') {
      throw new CurrencyError('INVALID_TIMESTAMP', 'Coinbase ticker must contain a trade time');
    }
    return Object.freeze({
      asset: 'XLM',
      currency: 'USD',
      rateUsdPerXlm: body.price,
      source: 'coinbase-exchange',
      sourceTimestamp: body.time,
    });
  }
}
