import {
  assertCents,
  centsForStellar,
  proportionalStellar,
  rateDecimal,
  stellarDecimal,
  stellarForCents,
  timestampNanos,
} from './currency.math';
import {
  CurrencyError,
  RefundCalculation,
  RefundedTotals,
  SettlementSnapshot,
} from './currency.types';

/**
 * Refund the snapshot's actual XLM amount pro rata, not at today's exchange rate.
 * The last refund receives the remaining stroops, preventing rounding dust.
 * The caller must persist and atomically update the supplied cumulative totals.
 */
export function calculateRefund(
  snapshot: SettlementSnapshot,
  fiatCents: number,
  alreadyRefunded: RefundedTotals = { fiatCents: 0, settlementAmount: '0' },
): RefundCalculation {
  try {
    if (
      !snapshot ||
      snapshot.asset !== 'XLM' ||
      snapshot.currency !== 'USD' ||
      typeof snapshot.rateSource !== 'string' ||
      !snapshot.rateSource.trim()
    ) {
      throw new Error('Invalid snapshot fields');
    }
    const rate = rateDecimal(snapshot.rateUsdPerXlm);
    timestampNanos(snapshot.rateSourceTimestamp);
    assertCents(snapshot.fiatCents);
    const amount = stellarDecimal(snapshot.settlementAmount);

    // Either side may have been fixed when the estimate was made.
    let fiatFixedMatches = false;
    let settlementFixedMatches = false;
    try {
      fiatFixedMatches = stellarForCents(snapshot.fiatCents, rate) === amount.toFixed(7);
    } catch {
      // The inverse conversion can be out of bounds even for a valid XLM-fixed quote.
    }
    try {
      settlementFixedMatches = centsForStellar(amount, rate) === snapshot.fiatCents;
    } catch {
      // The inverse conversion can be out of bounds even for a valid fiat-fixed quote.
    }
    if (!fiatFixedMatches && !settlementFixedMatches) {
      throw new Error('Snapshot amounts do not match the stored rate');
    }
  } catch (error) {
    throw new CurrencyError('INVALID_SNAPSHOT', 'Invalid settlement snapshot', { cause: error });
  }

  assertCents(fiatCents);
  if (!alreadyRefunded) {
    throw new CurrencyError('INVALID_AMOUNT', 'Refund totals are required');
  }
  assertCents(alreadyRefunded.fiatCents, true);
  const total = stellarDecimal(snapshot.settlementAmount);
  const prior = stellarDecimal(alreadyRefunded.settlementAmount, true);
  if (
    alreadyRefunded.fiatCents > snapshot.fiatCents ||
    prior.gt(total) ||
    (alreadyRefunded.fiatCents === 0) !== prior.isZero() ||
    fiatCents > snapshot.fiatCents - alreadyRefunded.fiatCents
  ) {
    throw new CurrencyError('INVALID_AMOUNT', 'Refund exceeds snapshot or remaining balance');
  }

  const remaining = total.minus(prior);
  const refund =
    fiatCents === snapshot.fiatCents - alreadyRefunded.fiatCents
      ? remaining
      : proportionalStellar(total, fiatCents, snapshot.fiatCents);
  if (refund.isZero() || refund.gt(remaining)) {
    throw new CurrencyError('INVALID_AMOUNT', 'Refund is not representable in remaining stroops');
  }
  return Object.freeze({
    asset: 'XLM',
    currency: 'USD',
    fiatCents,
    settlementAmount: refund.toFixed(7),
  });
}
