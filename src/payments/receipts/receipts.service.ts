import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma, Receipt } from '@prisma/client';
import { createHash, createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptStorageService } from './receipt-storage.service';
import { ReceiptSigningService } from './receipt-signing.service';
import {
  ReceiptPdfData,
  ReceiptPartyData,
  renderReceiptPdf,
} from './receipt-pdf';

const RECEIPTABLE_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
]);

const receiptPaymentInclude = Prisma.validator<Prisma.PaymentInclude>()({
  user: true,
  adoption: { include: { owner: true, adopter: true } },
  custody: {
    include: {
      holder: true,
      pet: { include: { currentOwner: true } },
    },
  },
  lines: { orderBy: { createdAt: 'asc' } },
});

type ReceiptPayment = Prisma.PaymentGetPayload<{
  include: typeof receiptPaymentInclude;
}>;

export interface ReceiptLinkView {
  receiptNumber: string;
  verificationCode: string;
  contentHash: string;
  issuedAt: string;
  url: string;
  expiresAt: string;
}

export interface ReceiptDownload {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: ReceiptStorageService,
    private readonly signing: ReceiptSigningService,
  ) {}

  /**
   * Returns a signed, expiring URL for a private receipt PDF, creating and
   * storing the receipt on first access.
   */
  async getReceiptLink(
    actor: { userId: string; role: string },
    paymentId: string,
  ): Promise<ReceiptLinkView> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, userId: true, status: true },
    });

    if (
      !payment ||
      (payment.userId !== actor.userId && actor.role !== 'ADMIN')
    ) {
      throw new NotFoundException('Payment not found');
    }
    if (!RECEIPTABLE_STATUSES.has(payment.status)) {
      throw new BadRequestException(
        'Receipts are available for paid payments only',
      );
    }

    const receipt = await this.getOrCreateReceipt(payment.id);
    const signed = this.signing.sign(payment.id, receipt.receiptNumber);
    const apiPrefix = this.config.get<string>('apiPrefix', 'api/v1');

    return {
      receiptNumber: receipt.receiptNumber.toString(),
      verificationCode: receipt.verificationCode,
      contentHash: receipt.contentHash,
      issuedAt: receipt.issuedAt.toISOString(),
      url: `/${apiPrefix}/payments/receipts/download/${signed.token}`,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /**
   * Validates a signed token and returns the stored PDF.
   */
  async download(token: string): Promise<ReceiptDownload> {
    const payload = this.signing.verify(token);

    const receipt = await this.prisma.receipt.findUnique({
      where: { paymentId: payload.paymentId },
    });

    if (!receipt || receipt.receiptNumber !== payload.receiptNumber) {
      throw new NotFoundException('Receipt not found');
    }

    const buffer = await this.storage.read(receipt.filePath);
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    if (contentHash !== receipt.contentHash) {
      throw new InternalServerErrorException(
        'Stored receipt failed its integrity check',
      );
    }

    return {
      buffer,
      fileName: `petad-receipt-${receipt.receiptNumber
        .toString()
        .padStart(8, '0')}.pdf`,
    };
  }

  /**
   * Idempotently produces the receipt for a payment.
   *
   * A transaction-scoped advisory lock serialises receipt creation, so
   * sequential numbers are allocated gap-free even under concurrency. If the
   * transaction rolls back, its number is never committed and the next attempt
   * reuses it.
   */
  private async getOrCreateReceipt(paymentId: string): Promise<Receipt> {
    const existing = await this.prisma.receipt.findUnique({
      where: { paymentId },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('petad.payment_receipts'))`;

      const raced = await tx.receipt.findUnique({ where: { paymentId } });
      if (raced) {
        return raced;
      }

      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: receiptPaymentInclude,
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }
      if (!RECEIPTABLE_STATUSES.has(payment.status)) {
        throw new BadRequestException(
          'Receipts are available for paid payments only',
        );
      }

      const highest = await tx.receipt.aggregate({
        _max: { receiptNumber: true },
      });
      const receiptNumber = (highest._max.receiptNumber ?? 0n) + 1n;
      const verificationCode = this.verificationCode(payment.id, receiptNumber);

      const pdf = await renderReceiptPdf(
        this.buildPdfData(payment, receiptNumber, verificationCode),
      );
      const contentHash = createHash('sha256').update(pdf).digest('hex');
      const filePath = await this.storage.write(payment.id, pdf);

      return tx.receipt.create({
        data: {
          paymentId: payment.id,
          receiptNumber,
          verificationCode,
          filePath,
          contentHash,
        },
      });
    });
  }

  private buildPdfData(
    payment: ReceiptPayment,
    receiptNumber: bigint,
    verificationCode: string,
  ): ReceiptPdfData {
    const parties: ReceiptPartyData[] = [];

    if (payment.adoption) {
      parties.push({
        role: 'Adoption owner',
        displayName: this.displayName(payment.adoption.owner),
      });
      parties.push({
        role: 'Adopter',
        displayName: this.displayName(payment.adoption.adopter),
      });
    }

    if (payment.custody) {
      parties.push({
        role: 'Custodian',
        displayName: this.displayName(payment.custody.holder),
      });
      if (payment.custody.pet?.currentOwner) {
        parties.push({
          role: 'Pet owner',
          displayName: this.displayName(payment.custody.pet.currentOwner),
        });
      }
    }

    return {
      paymentId: payment.id,
      status: payment.status,
      purpose: payment.purpose,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      feeMinor: payment.feeMinor,
      refundedAmountMinor: payment.refundedAmountMinor,
      settlementFeeMinor: payment.settlementFeeMinor,
      settlementPenaltyMinor: payment.settlementPenaltyMinor,
      settlementRefundMinor: payment.settlementRefundMinor,
      txHash: payment.txHash,
      externalRef: payment.externalRef,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      payer: this.displayName(payment.user),
      parties,
      lines: payment.lines.map((line) => ({
        type: line.type,
        account: line.account,
        direction: line.direction,
        amountMinor: line.amountMinor,
        description: line.description,
      })),
      receiptNumber,
      verificationCode,
    };
  }

  private displayName(user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  }): string {
    const name = [user.firstName, user.lastName]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' ')
      .trim();

    return name.length > 0 ? name : user.email;
  }

  private verificationCode(paymentId: string, receiptNumber: bigint): string {
    const secret =
      this.config.get<string>('payments.receiptSigningSecret') ??
      this.config.get<string>('jwtSecret');

    if (!secret) {
      throw new Error('Receipt signing secret is not configured');
    }

    return createHmac('sha256', secret)
      .update(`receipt-code:${paymentId}:${receiptNumber.toString()}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();
  }
}
