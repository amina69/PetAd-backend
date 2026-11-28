import type {
  Payment,
  PaymentLine,
  PaymentQuote,
  Receipt,
  Refund,
} from '@prisma/client';

export interface QuoteView {
  id: string;
  userId: string;
  purpose: string;
  currency: string;
  amountMinor: string;
  feeRateBps: number;
  feeMinor: string;
  totalMinor: string;
  escrowId: string | null;
  custodyId: string | null;
  adoptionId: string | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface PaymentLineView {
  id: string;
  account: string;
  direction: string;
  type: string;
  amountMinor: string;
  currency: string;
  description: string | null;
  createdAt: string;
}

export interface RefundView {
  id: string;
  amountMinor: string;
  currency: string;
  status: string;
  reason: string | null;
  externalRef: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface ReceiptSummaryView {
  id: string;
  receiptNumber: string;
  verificationCode: string;
  contentHash: string;
  issuedAt: string;
}

export interface PaymentView {
  id: string;
  userId: string;
  purpose: string;
  status: string;
  amountMinor: string;
  currency: string;
  feeRateBps: number;
  feeMinor: string;
  refundedAmountMinor: string;
  settlementRefundMinor: string | null;
  settlementPenaltyMinor: string | null;
  settlementFeeMinor: string | null;
  settledAt: string | null;
  escrowId: string | null;
  custodyId: string | null;
  adoptionId: string | null;
  externalRef: string | null;
  txHash: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: PaymentLineView[];
  refunds?: RefundView[];
  receipt?: ReceiptSummaryView | null;
}

export interface PaymentPageView {
  data: PaymentView[];
  nextCursor: string | null;
}

export function mapQuote(quote: PaymentQuote): QuoteView {
  return {
    id: quote.id,
    userId: quote.userId,
    purpose: quote.purpose,
    currency: quote.currency,
    amountMinor: quote.amountMinor.toString(),
    feeRateBps: quote.feeRateBps,
    feeMinor: quote.feeMinor.toString(),
    totalMinor: quote.totalMinor.toString(),
    escrowId: quote.escrowId,
    custodyId: quote.custodyId,
    adoptionId: quote.adoptionId,
    expiresAt: quote.expiresAt.toISOString(),
    consumedAt: quote.consumedAt?.toISOString() ?? null,
    createdAt: quote.createdAt.toISOString(),
  };
}

export function mapLine(line: PaymentLine): PaymentLineView {
  return {
    id: line.id,
    account: line.account,
    direction: line.direction,
    type: line.type,
    amountMinor: line.amountMinor.toString(),
    currency: line.currency,
    description: line.description,
    createdAt: line.createdAt.toISOString(),
  };
}

export function mapRefund(refund: Refund): RefundView {
  return {
    id: refund.id,
    amountMinor: refund.amountMinor.toString(),
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    externalRef: refund.externalRef,
    txHash: refund.txHash,
    createdAt: refund.createdAt.toISOString(),
  };
}

export function mapReceipt(receipt: Receipt): ReceiptSummaryView {
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber.toString(),
    verificationCode: receipt.verificationCode,
    contentHash: receipt.contentHash,
    issuedAt: receipt.issuedAt.toISOString(),
  };
}

export type PaymentWithRelations = Payment & {
  lines?: PaymentLine[];
  refunds?: Refund[];
  receipt?: Receipt | null;
};

export function mapPayment(payment: PaymentWithRelations): PaymentView {
  const view: PaymentView = {
    id: payment.id,
    userId: payment.userId,
    purpose: payment.purpose,
    status: payment.status,
    amountMinor: payment.amountMinor.toString(),
    currency: payment.currency,
    feeRateBps: payment.feeRateBps,
    feeMinor: payment.feeMinor.toString(),
    refundedAmountMinor: payment.refundedAmountMinor.toString(),
    settlementRefundMinor: payment.settlementRefundMinor?.toString() ?? null,
    settlementPenaltyMinor: payment.settlementPenaltyMinor?.toString() ?? null,
    settlementFeeMinor: payment.settlementFeeMinor?.toString() ?? null,
    settledAt: payment.settledAt?.toISOString() ?? null,
    escrowId: payment.escrowId,
    custodyId: payment.custodyId,
    adoptionId: payment.adoptionId,
    externalRef: payment.externalRef,
    txHash: payment.txHash,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };

  if (payment.lines) {
    view.lines = payment.lines.map(mapLine);
  }
  if (payment.refunds) {
    view.refunds = payment.refunds.map(mapRefund);
  }
  if (payment.receipt !== undefined) {
    view.receipt = payment.receipt ? mapReceipt(payment.receipt) : null;
  }

  return view;
}
