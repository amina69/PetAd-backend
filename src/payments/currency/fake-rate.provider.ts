import { CurrencyError, CurrencyPair, ExchangeRate, RateProvider } from './currency.types';

/** Controllable provider for tests; it never consults the system clock or network. */
export class FakeRateProvider implements RateProvider {
  private failure: Error | null = null;
  calls = 0;

  constructor(private rate: ExchangeRate) {}

  setRate(rate: ExchangeRate): void {
    this.rate = rate;
  }

  failWith(error: Error | null): void {
    this.failure = error;
  }

  async getRate(pair: CurrencyPair): Promise<ExchangeRate> {
    this.calls += 1;
    if (!pair || pair.asset !== 'XLM' || pair.currency !== 'USD') {
      throw new CurrencyError('UNSUPPORTED_PAIR', 'Only XLM/USD is supported');
    }
    if (this.failure) throw this.failure;
    return { ...this.rate };
  }
}
