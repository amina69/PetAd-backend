import { PaymentPurpose, PaymentStatus } from '@prisma/client';
import {
  mapPayment,
  mapQuote,
  mapReceipt,
  mapRefund,
} from './payment-response.dto';

const AT = new Date('2026-03-01T10:00:00.000Z');

describe('payment response mappers', () => {
  it('serialises quote bigints and dates', () => {
    const view = mapQuote({
      id: 'quote-1',
      userId: 'user-1',
      purpose: PaymentPurpose.DEPOSIT,
      currency: 'XLM',
      amountMinor: 123n,
      feeRateBps: 250,
      feeMinor: 3n,
      totalMinor: 123n,
      escrowId: null,
      custodyId: null,
      adoptionId: null,
      expiresAt: AT,
      consumedAt: null,
      createdAt: AT,
    });

    expect(view.amountMinor).toBe('123');
    expect(view.feeMinor).toBe('3');
    expect(view.totalMinor).toBe('123');
    expect(view.expiresAt).toBe(AT.toISOString());
    expect(view.consumedAt).toBeNull();
  });

  it('includes optional relations only when loaded', () => {
    const base = {
      id: 'payment-1',
      userId: 'user-1',
      purpose: PaymentPurpose.DEPOSIT,
      status: PaymentStatus.PAID,
      amountMinor: 100n,
      currency: 'XLM',
      feeRateBps: 250,
      feeMinor: 2n,
      refundedAmountMinor: 0n,
      settlementRefundMinor: null,
      settlementPenaltyMinor: null,
      settlementFeeMinor: null,
      settledAt: null,
      escrowId: null,
      custodyId: null,
      adoptionId: null,
      externalRef: null,
      txHash: null,
      paidAt: null,
      createdAt: AT,
      updatedAt: AT,
    };

    const lean = mapPayment(base);
    expect(lean.lines).toBeUndefined();
    expect(lean.refunds).toBeUndefined();
    expect(lean.receipt).toBeUndefined();

    const detailed = mapPayment({
      ...base,
      lines: [
        {
          id: 'line-1',
          paymentId: 'payment-1',
          account: 'USER_WALLET',
          direction: 'DEBIT',
          type: 'PRINCIPAL',
          amountMinor: 100n,
          currency: 'XLM',
          description: null,
          createdAt: AT,
        },
      ],
      refunds: [
        {
          id: 'refund-1',
          paymentId: 'payment-1',
          amountMinor: 10n,
          currency: 'XLM',
          status: 'COMPLETED',
          reason: 'test',
          externalRef: null,
          txHash: null,
          createdById: 'user-1',
          createdAt: AT,
          updatedAt: AT,
        },
      ],
      receipt: {
        id: 'receipt-1',
        paymentId: 'payment-1',
        receiptNumber: 7n,
        verificationCode: 'CODE',
        filePath: '/tmp/x.pdf',
        contentHash: 'hash',
        issuedAt: AT,
        createdAt: AT,
      },
    });

    expect(detailed.lines).toEqual([
      {
        id: 'line-1',
        account: 'USER_WALLET',
        direction: 'DEBIT',
        type: 'PRINCIPAL',
        amountMinor: '100',
        currency: 'XLM',
        description: null,
        createdAt: AT.toISOString(),
      },
    ]);
    expect(detailed.refunds?.[0].amountMinor).toBe('10');
    expect(detailed.receipt?.receiptNumber).toBe('7');
  });

  it('maps a null receipt distinctly from an unloaded one', () => {
    const view = mapPayment({
      id: 'payment-1',
      userId: 'user-1',
      purpose: PaymentPurpose.FEE,
      status: PaymentStatus.PAID,
      amountMinor: 1n,
      currency: 'XLM',
      feeRateBps: 0,
      feeMinor: 1n,
      refundedAmountMinor: 0n,
      settlementRefundMinor: 1n,
      settlementPenaltyMinor: 0n,
      settlementFeeMinor: 0n,
      settledAt: AT,
      escrowId: null,
      custodyId: null,
      adoptionId: null,
      externalRef: null,
      txHash: null,
      paidAt: AT,
      createdAt: AT,
      updatedAt: AT,
      receipt: null,
    });

    expect(view.receipt).toBeNull();
    expect(view.settlementRefundMinor).toBe('1');
    expect(view.paidAt).toBe(AT.toISOString());
  });

  it('maps refunds and receipts', () => {
    expect(
      mapRefund({
        id: 'refund-1',
        paymentId: 'payment-1',
        amountMinor: 5n,
        currency: 'XLM',
        status: 'COMPLETED',
        reason: null,
        externalRef: 'fake_re_1',
        txHash: null,
        createdById: 'user-1',
        createdAt: AT,
        updatedAt: AT,
      }),
    ).toEqual({
      id: 'refund-1',
      amountMinor: '5',
      currency: 'XLM',
      status: 'COMPLETED',
      reason: null,
      externalRef: 'fake_re_1',
      txHash: null,
      createdAt: AT.toISOString(),
    });

    expect(
      mapReceipt({
        id: 'receipt-1',
        paymentId: 'payment-1',
        receiptNumber: 8n,
        verificationCode: 'CODE',
        filePath: '/tmp/x.pdf',
        contentHash: 'hash',
        issuedAt: AT,
        createdAt: AT,
      }),
    ).toEqual({
      id: 'receipt-1',
      receiptNumber: '8',
      verificationCode: 'CODE',
      contentHash: 'hash',
      issuedAt: AT.toISOString(),
    });
  });
});
