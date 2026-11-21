import { BadRequestException } from '@nestjs/common';
import { PaymentPurpose } from '@prisma/client';
import { multiplyBpsRoundHalfUp } from './money';

/**
 * Settlement split for a refundable deposit:
 *
 *   deposit = refund + penalty + fee
 *
 * This is the conservation invariant the payments ledger relies on. The split
 * is computed with exact integer arithmetic, so it always reconciles.
 */
export interface DepositSettlement {
  depositMinor: bigint;
  feeMinor: bigint;
  penaltyMinor: bigint;
  refundMinor: bigint;
}

export function computeDepositSettlement(
  depositMinor: bigint,
  feeRateBps: number,
  penaltyMinor: bigint = 0n,
): DepositSettlement {
  if (depositMinor <= 0n) {
    throw new BadRequestException('depositMinor must be positive');
  }
  if (penaltyMinor < 0n) {
    throw new BadRequestException('penaltyMinor cannot be negative');
  }

  const feeMinor = multiplyBpsRoundHalfUp(depositMinor, feeRateBps);
  const afterFee = depositMinor - feeMinor;

  if (penaltyMinor > afterFee) {
    throw new BadRequestException(
      'penaltyMinor exceeds the refundable part of the deposit',
    );
  }

  const refundMinor = afterFee - penaltyMinor;

  if (refundMinor + penaltyMinor + feeMinor !== depositMinor) {
    // Defensive: unreachable with the arithmetic above. Kept as a hard
    // guarantee that no rounding path can break conservation.
    throw new Error('Deposit settlement violates conservation invariant');
  }

  return {
    depositMinor,
    feeMinor,
    penaltyMinor,
    refundMinor,
  };
}

export interface RefundablePaymentState {
  purpose: PaymentPurpose;
  amountMinor: bigint;
  refundedAmountMinor: bigint;
  settlementRefundMinor: bigint | null;
}

/**
 * Maximum amount that may still be refunded for a payment.
 *
 * - DEPOSIT: only the settled refund portion (deposit - fee - penalty) is
 *   refundable; the payment must be settled first.
 * - TOPUP: the full amount.
 * - FEE / REFUND: not refundable.
 */
export function computeRefundCap(payment: RefundablePaymentState): bigint {
  let cap: bigint;

  switch (payment.purpose) {
    case PaymentPurpose.DEPOSIT:
      cap = payment.settlementRefundMinor ?? 0n;
      break;
    case PaymentPurpose.TOPUP:
      cap = payment.amountMinor;
      break;
    default:
      cap = 0n;
  }

  const remaining = cap - payment.refundedAmountMinor;
  return remaining > 0n ? remaining : 0n;
}

export interface LedgerLineLike {
  direction: string;
  amountMinor: bigint | number;
}

/**
 * Assert a set of ledger lines is a balanced double-entry posting.
 * Optionally asserts each side matches an expected total.
 */
export function assertLedgerBalanced(
  lines: LedgerLineLike[],
  expectedTotalMinor?: bigint,
): void {
  let debitMinor = 0n;
  let creditMinor = 0n;

  for (const line of lines) {
    const amountMinor = toIntegerMinorUnits(line.amountMinor);
    if (amountMinor <= 0n) {
      throw new Error('Payment ledger lines must be positive');
    }
    if (line.direction === 'DEBIT') {
      debitMinor += amountMinor;
    } else if (line.direction === 'CREDIT') {
      creditMinor += amountMinor;
    } else {
      throw new Error(`Unknown ledger direction: ${String(line.direction)}`);
    }
  }

  if (debitMinor !== creditMinor) {
    throw new Error(
      `Unbalanced payment ledger: debits=${debitMinor} credits=${creditMinor}`,
    );
  }

  if (expectedTotalMinor !== undefined && debitMinor !== expectedTotalMinor) {
    throw new Error(
      `Payment ledger total ${debitMinor} does not match payment amount ${expectedTotalMinor}`,
    );
  }
}

/**
 * Coerce a Prisma BigInt field (typed `bigint | number`) to bigint without
 * ever accepting a fractional value.
 */
function toIntegerMinorUnits(value: bigint | number): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('Payment ledger amounts must be integers');
  }
  return BigInt(value);
}
