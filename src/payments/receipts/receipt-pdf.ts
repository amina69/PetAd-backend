import PDFDocument from 'pdfkit';
import { formatMinorUnits } from '../money';

export interface ReceiptLineData {
  type: string;
  account: string;
  direction: string;
  amountMinor: bigint;
  description: string | null;
}

export interface ReceiptPartyData {
  role: string;
  displayName: string;
}

export interface ReceiptPdfData {
  paymentId: string;
  status: string;
  purpose: string;
  currency: string;
  amountMinor: bigint;
  feeMinor: bigint;
  refundedAmountMinor: bigint;
  settlementFeeMinor: bigint | null;
  settlementPenaltyMinor: bigint | null;
  settlementRefundMinor: bigint | null;
  txHash: string | null;
  externalRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
  payer: string;
  parties: ReceiptPartyData[];
  lines: ReceiptLineData[];
  receiptNumber: bigint;
  verificationCode: string;
}

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
const COLORS = {
  ink: '#111827',
  muted: '#6b7280',
  rule: '#d1d5db',
  accent: '#1f6feb',
};

function safe(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value.trim() : '—';
}

function formatDate(date: Date | null): string {
  if (!date) {
    return '—';
  }
  return date.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

/**
 * Renders a receipt PDF.
 *
 * The output is deterministic for a given input: document metadata is pinned
 * to the payment's own timestamps (never `new Date()`), amounts are formatted
 * from exact integers and no random identifiers are embedded. Regenerating a
 * receipt for the same payment therefore produces byte-identical content.
 */
export function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const documentDate = data.paidAt ?? data.createdAt;

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    // Uncompressed content keeps the PDF trivially inspectable and keeps
    // byte-for-byte determinism independent of zlib versions.
    compress: false,
    info: {
      Title: `PetAd receipt ${data.receiptNumber.toString()}`,
      Author: 'PetAd',
      Subject: `Payment ${data.paymentId}`,
      Keywords: `petad receipt payment ${data.paymentId}`,
      CreationDate: documentDate,
      ModDate: documentDate,
    },
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = PAGE.margin;

  const amount = (value: bigint) =>
    `${formatMinorUnits(value, data.currency)} ${data.currency}`;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    }
  };

  const rule = () => {
    doc
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.width - PAGE.margin, y)
      .strokeColor(COLORS.rule)
      .lineWidth(0.75)
      .stroke();
    y += 10;
  };

  // ─── Header ───────────────────────────────────────────
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(22);
  doc.text('PetAd', PAGE.margin, y);
  doc.fillColor(COLORS.ink).fontSize(16);
  doc.text('Payment Receipt', PAGE.margin, y, { align: 'right' });
  y += 30;

  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
  doc.text(
    `Receipt ${data.receiptNumber.toString().padStart(8, '0')}  ·  Issued ${formatDate(documentDate)}`,
    PAGE.margin,
    y,
  );
  y += 18;
  rule();

  // ─── Summary card ─────────────────────────────────────
  const labelX = PAGE.margin;
  const valueX = PAGE.margin + 150;
  const summary: Array<[string, string]> = [
    ['Receipt number', data.receiptNumber.toString().padStart(8, '0')],
    ['Payment ID', data.paymentId],
    ['Status', data.status],
    ['Purpose', data.purpose],
    ['Payment amount', amount(data.amountMinor)],
    ['On-chain reference', safe(data.txHash)],
    ['Provider reference', safe(data.externalRef)],
    ['Verification code', data.verificationCode],
  ];

  doc.fontSize(9);
  for (const [label, value] of summary) {
    ensureSpace(16);
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .text(label, labelX, y, { width: 140 });
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica')
      .text(value, valueX, y, {
        width: PAGE.width - PAGE.margin - valueX,
        lineBreak: true,
      });
    y +=
      Math.max(
        doc.heightOfString(value, {
          width: PAGE.width - PAGE.margin - valueX,
        }),
        12,
      ) + 4;
  }

  y += 6;
  rule();

  // ─── Parties ──────────────────────────────────────────
  ensureSpace(20);
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Parties', PAGE.margin, y);
  y += 18;

  const parties: ReceiptPartyData[] = [
    { role: 'Payer', displayName: data.payer },
    ...data.parties,
  ];
  doc.fontSize(9);
  for (const party of parties) {
    ensureSpace(15);
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .text(party.role, labelX, y, { width: 140 });
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica')
      .text(party.displayName, valueX, y, {
        width: PAGE.width - PAGE.margin - valueX,
      });
    y += 14;
  }

  y += 6;
  rule();

  // ─── Itemised ledger lines ────────────────────────────
  ensureSpace(24);
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Itemised ledger lines', PAGE.margin, y);
  y += 18;

  const columns = {
    type: PAGE.margin,
    account: PAGE.margin + 70,
    description: PAGE.margin + 180,
    amount: PAGE.width - PAGE.margin - 120,
  };
  const amountWidth = 120;

  const header = () => {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('TYPE', columns.type, y, { width: 65 })
      .text('ACCOUNT', columns.account, y, { width: 100 })
      .text('DESCRIPTION', columns.description, y, { width: 180 })
      .text('AMOUNT', columns.amount, y, {
        width: amountWidth,
        align: 'right',
      });
    y += 12;
    rule();
  };

  header();
  doc.fontSize(9);

  for (const line of data.lines) {
    ensureSpace(24);
    const description = safe(line.description);
    const rowHeight =
      Math.max(doc.heightOfString(description, { width: 180 }), 12) + 5;

    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .text(
        `${line.type} (${line.direction === 'DEBIT' ? 'DR' : 'CR'})`,
        columns.type,
        y,
        {
          width: 65,
        },
      )
      .font('Helvetica')
      .text(line.account, columns.account, y, { width: 100 })
      .text(description, columns.description, y, { width: 180 });
    doc.text(amount(line.amountMinor), columns.amount, y, {
      width: amountWidth,
      align: 'right',
    });

    y += rowHeight;
    rule();
  }

  if (data.lines.length === 0) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .text('No ledger lines recorded.', columns.type, y);
    y += 16;
    rule();
  }

  // ─── Totals (fees / penalties / refunds) ──────────────
  y += 8;
  ensureSpace(80);
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Totals', PAGE.margin, y);
  y += 18;

  const totals: Array<[string, bigint]> = [
    ['Deposit / payment', data.amountMinor],
    ['Platform fee', data.settlementFeeMinor ?? data.feeMinor],
  ];
  if (
    data.settlementPenaltyMinor !== null &&
    data.settlementPenaltyMinor > 0n
  ) {
    totals.push(['Penalty', data.settlementPenaltyMinor]);
  }
  totals.push(['Refunded to date', data.refundedAmountMinor]);

  if (data.settlementRefundMinor !== null) {
    const outstanding =
      data.settlementRefundMinor > data.refundedAmountMinor
        ? data.settlementRefundMinor - data.refundedAmountMinor
        : 0n;
    totals.push(['Refundable remaining', outstanding]);
  }

  doc.fontSize(9);
  for (const [label, value] of totals) {
    ensureSpace(15);
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .text(label, columns.description, y, { width: 180 });
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .text(amount(value), columns.amount, y, {
        width: amountWidth,
        align: 'right',
      });
    y += 14;
  }

  // ─── Footer ───────────────────────────────────────────
  y += 12;
  ensureSpace(60);
  rule();
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(8)
    .text(
      `This receipt was generated by PetAd. To verify it, quote receipt number ` +
        `${data.receiptNumber.toString().padStart(8, '0')} and verification code ` +
        `${data.verificationCode}. The document is stored privately and was delivered ` +
        `through a signed, expiring URL.`,
      PAGE.margin,
      y,
      { width: PAGE.width - PAGE.margin * 2, align: 'center' },
    );

  doc.end();

  return finished;
}
