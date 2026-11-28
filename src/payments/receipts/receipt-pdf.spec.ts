import { renderReceiptPdf, ReceiptPdfData } from './receipt-pdf';

function receiptPdfData(
  overrides: Partial<ReceiptPdfData> = {},
): ReceiptPdfData {
  return {
    paymentId: 'pay-test-1',
    status: 'PARTIALLY_REFUNDED',
    purpose: 'DEPOSIT',
    currency: 'XLM',
    amountMinor: 1000000000n, // 100.0000000 XLM
    feeMinor: 25000000n, // 2.5000000 XLM
    refundedAmountMinor: 10000000n, // 1.0000000 XLM
    settlementFeeMinor: 25000000n,
    settlementPenaltyMinor: 50000000n, // 5.0000000 XLM
    settlementRefundMinor: 925000000n, // 92.5000000 XLM
    txHash: 'fake_stellar_abc123',
    externalRef: 'fake_ch_123',
    paidAt: new Date('2026-03-04T10:00:00.000Z'),
    createdAt: new Date('2026-03-04T09:59:00.000Z'),
    payer: 'Ada Lovelace',
    parties: [
      { role: 'Adoption owner', displayName: 'Grace Hopper' },
      { role: 'Adopter', displayName: 'Ada Lovelace' },
    ],
    lines: [
      {
        type: 'PRINCIPAL',
        account: 'USER_WALLET',
        direction: 'DEBIT',
        amountMinor: 1000000000n,
        description: 'Deposit paid by user',
      },
      {
        type: 'PRINCIPAL',
        account: 'ESCROW',
        direction: 'CREDIT',
        amountMinor: 1000000000n,
        description: 'Deposit held in escrow',
      },
      {
        type: 'PRINCIPAL',
        account: 'ESCROW',
        direction: 'DEBIT',
        amountMinor: 1000000000n,
        description: 'Deposit released from escrow',
      },
      {
        type: 'REFUND',
        account: 'USER_WALLET',
        direction: 'CREDIT',
        amountMinor: 925000000n,
        description: 'Refund payable to user',
      },
      {
        type: 'PENALTY',
        account: 'PENALTY',
        direction: 'CREDIT',
        amountMinor: 50000000n,
        description: 'Penalty withheld from deposit',
      },
      {
        type: 'FEE',
        account: 'PLATFORM_FEE',
        direction: 'CREDIT',
        amountMinor: 25000000n,
        description: 'Platform fee retained',
      },
    ],
    receiptNumber: 42n,
    verificationCode: 'VERIFY-CODE-1234',
    ...overrides,
  };
}

/**
 * PDFKit writes standard-font text as hex strings inside `TJ` arrays (with
 * kerning splits), so decode every hex string and concatenate it to recover
 * the visible text.
 */
function pdfText(buffer: Buffer): string {
  const tokens: string[] =
    buffer.toString('latin1').match(/<[0-9A-Fa-f]+>/g) ?? [];
  return tokens
    .map((token) => Buffer.from(token.slice(1, -1), 'hex').toString('latin1'))
    .join('');
}

describe('renderReceiptPdf', () => {
  it('produces a PDF', async () => {
    const buffer = await renderReceiptPdf(receiptPdfData());
    const text = pdfText(buffer);

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(text).toContain('PetAd');
    expect(text).toContain('Payment Receipt');
    expect(text).toContain('pay-test-1');
    expect(text).toContain('00000042');
    expect(text).toContain('VERIFY-CODE-1234');
  });

  it('contains the itemised ledger lines and totals exactly', async () => {
    const text = pdfText(await renderReceiptPdf(receiptPdfData()));

    for (const expected of [
      'Deposit paid by user',
      'Deposit held in escrow',
      'Deposit released from escrow',
      'Refund payable to user',
      'Penalty withheld from deposit',
      'Platform fee retained',
      '100.0000000 XLM',
      '2.5000000 XLM',
      '5.0000000 XLM',
      '92.5000000 XLM',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('is byte-identical when regenerated for the same payment', async () => {
    const data = receiptPdfData();
    const first = await renderReceiptPdf(data);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await renderReceiptPdf(data);

    expect(second.equals(first)).toBe(true);
  });

  it('includes all parties and the on-chain reference', async () => {
    const text = pdfText(await renderReceiptPdf(receiptPdfData()));

    expect(text).toContain('Payer');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Adoption owner');
    expect(text).toContain('Adopter');
    expect(text).toContain('fake_stellar_abc123');
  });

  it('renders a receipt with no ledger lines without crashing', async () => {
    const buffer = await renderReceiptPdf(
      receiptPdfData({
        lines: [],
        parties: [],
        txHash: null,
        externalRef: null,
      }),
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfText(buffer)).toContain('No ledger lines recorded.');
  });
});
