import { BadRequestException } from '@nestjs/common';
import { PaymentPurpose } from '@prisma/client';
import {
  assertLedgerBalanced,
  computeDepositSettlement,
  computeRefundCap,
} from './settlement';

/** Deterministic 32-bit LCG so property tests are reproducible. */
function createRandom(seed = 0x2f6e2b1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

describe('payments/settlement', () => {
  describe('computeDepositSettlement (property tests)', () => {
    it('always conserves the deposit: refund + penalty + fee = deposit', () => {
      const next = createRandom();

      for (let i = 0; i < 5000; i += 1) {
        const depositMinor = BigInt(next() % 1_000_000_000) + 1n;
        const feeRateBps = next() % 10001;
        const feeMinor = (depositMinor * BigInt(feeRateBps) + 5000n) / 10000n;
        const afterFee = depositMinor - feeMinor;
        const penaltyMinor =
          afterFee > 0n ? BigInt(next()) % (afterFee + 1n) : 0n;

        const settlement = computeDepositSettlement(
          depositMinor,
          feeRateBps,
          penaltyMinor,
        );

        expect(typeof settlement.feeMinor).toBe('bigint');
        expect(typeof settlement.refundMinor).toBe('bigint');
        expect(settlement.refundMinor).toBeGreaterThanOrEqual(0n);
        expect(settlement.feeMinor).toBe(feeMinor);
        expect(settlement.penaltyMinor).toBe(penaltyMinor);
        expect(
          settlement.refundMinor +
            settlement.penaltyMinor +
            settlement.feeMinor,
        ).toBe(depositMinor);
      }
    });

    it('rounds the fee half up', () => {
      expect(computeDepositSettlement(200n, 250, 0n).feeMinor).toBe(5n); // 5.0
      expect(computeDepositSettlement(100n, 250, 0n).feeMinor).toBe(3n); // 2.5 -> 3
      expect(computeDepositSettlement(60n, 250, 0n).feeMinor).toBe(2n); // 1.5 -> 2
      expect(computeDepositSettlement(40n, 250, 0n).feeMinor).toBe(1n); // 1.0
      expect(computeDepositSettlement(20n, 250, 0n).feeMinor).toBe(1n); // 0.5 -> 1
      expect(computeDepositSettlement(19n, 250, 0n).feeMinor).toBe(0n); // 0.475 -> 0
    });

    it('rejects non-positive deposits, negative penalties and overdrawn penalties', () => {
      expect(() => computeDepositSettlement(0n, 100)).toThrow(
        BadRequestException,
      );
      expect(() => computeDepositSettlement(-5n, 100)).toThrow(
        BadRequestException,
      );
      expect(() => computeDepositSettlement(100n, 100, -1n)).toThrow(
        BadRequestException,
      );
      expect(() => computeDepositSettlement(100n, 100, 100n)).toThrow(
        /penaltyMinor exceeds/,
      );
    });

    it('allows the whole deposit to be a penalty when the fee is zero', () => {
      const settlement = computeDepositSettlement(1000n, 0, 1000n);
      expect(settlement).toEqual({
        depositMinor: 1000n,
        feeMinor: 0n,
        penaltyMinor: 1000n,
        refundMinor: 0n,
      });
    });
  });

  describe('computeRefundCap', () => {
    it('caps deposits at the settled refundable amount', () => {
      expect(
        computeRefundCap({
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: 10000n,
          refundedAmountMinor: 0n,
          settlementRefundMinor: null,
        }),
      ).toBe(0n);

      expect(
        computeRefundCap({
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: 10000n,
          refundedAmountMinor: 3000n,
          settlementRefundMinor: 9250n,
        }),
      ).toBe(6250n);
    });

    it('caps top-ups at the unrefunded amount', () => {
      expect(
        computeRefundCap({
          purpose: PaymentPurpose.TOPUP,
          amountMinor: 5000n,
          refundedAmountMinor: 1000n,
          settlementRefundMinor: null,
        }),
      ).toBe(4000n);
    });

    it('never returns a negative cap', () => {
      expect(
        computeRefundCap({
          purpose: PaymentPurpose.TOPUP,
          amountMinor: 5000n,
          refundedAmountMinor: 5000n,
          settlementRefundMinor: null,
        }),
      ).toBe(0n);
      expect(
        computeRefundCap({
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: 5000n,
          refundedAmountMinor: 6000n,
          settlementRefundMinor: 5000n,
        }),
      ).toBe(0n);
    });

    it('makes fees and refunds non-refundable', () => {
      for (const purpose of [PaymentPurpose.FEE, PaymentPurpose.REFUND]) {
        expect(
          computeRefundCap({
            purpose,
            amountMinor: 5000n,
            refundedAmountMinor: 0n,
            settlementRefundMinor: 5000n,
          }),
        ).toBe(0n);
      }
    });
  });

  describe('assertLedgerBalanced', () => {
    const line = (direction: string, amountMinor: bigint | number) => ({
      direction,
      amountMinor,
    });

    it('accepts balanced postings matching the expected total', () => {
      expect(() =>
        assertLedgerBalanced(
          [line('DEBIT', 100n), line('CREDIT', 60n), line('CREDIT', 40)],
          100n,
        ),
      ).not.toThrow();
    });

    it('rejects unbalanced postings', () => {
      expect(() =>
        assertLedgerBalanced([line('DEBIT', 100n), line('CREDIT', 99n)]),
      ).toThrow(/Unbalanced/);
    });

    it('rejects a mismatched expected total', () => {
      expect(() =>
        assertLedgerBalanced([line('DEBIT', 100n), line('CREDIT', 100n)], 101n),
      ).toThrow(/does not match/);
    });

    it('rejects non-positive lines, unknown directions and fractional numbers', () => {
      expect(() =>
        assertLedgerBalanced([line('DEBIT', 0n), line('CREDIT', 0n)]),
      ).toThrow(/positive/);
      expect(() =>
        assertLedgerBalanced([line('SIDEWAYS', 1n), line('CREDIT', 1n)]),
      ).toThrow(/Unknown ledger direction/);
      expect(() =>
        assertLedgerBalanced([line('DEBIT', 1.5), line('CREDIT', 1.5)]),
      ).toThrow(/integers/);
    });
  });
});
