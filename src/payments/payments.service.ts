import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EscrowStatus,
  EventEntityType,
  EventType,
  Payment,
  PaymentLineDirection,
  PaymentLineType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import { LEDGER_ACCOUNTS } from './ledger-accounts';
import { parseMinorUnits, multiplyBpsRoundHalfUp } from './money';
import {
  assertLedgerBalanced,
  computeDepositSettlement,
  computeRefundCap,
  DepositSettlement,
} from './settlement';
import { PAYMENT_PROVIDER } from './provider/payment-provider.interface';
import type { PaymentProvider } from './provider/payment-provider.interface';
import {
  CompletePaymentDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PayPaymentDto,
  RefundPaymentDto,
} from './dto/payment-actions.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import {
  mapPayment,
  mapQuote,
  PaymentPageView,
  PaymentView,
  PaymentWithRelations,
  QuoteView,
} from './dto/payment-response.dto';

const QUOTE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_FEE_RATE_BPS = 250;
const DEFAULT_PAGE_LIMIT = 25;

const paymentInclude = Prisma.validator<Prisma.PaymentInclude>()({
  lines: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  receipt: true,
});

interface PaymentCursor {
  createdAt: Date;
  id: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly loggingService: LoggingService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ─── Quotes ────────────────────────────────────────────────────────────

  async createQuote(userId: string, dto: CreateQuoteDto): Promise<QuoteView> {
    const amountMinor = parseMinorUnits(dto.amountMinor);
    if (amountMinor <= 0n) {
      throw new BadRequestException('amountMinor must be positive');
    }

    await this.assertEntityLinks(userId, dto);

    const currency = (dto.currency ?? 'XLM').toUpperCase();
    const feeRateBps = this.feeRateBps;

    const feeMinor = this.feeForPurpose(dto.purpose, amountMinor, feeRateBps);
    const totalMinor = amountMinor;

    const quote = await this.prisma.paymentQuote.create({
      data: {
        userId,
        purpose: dto.purpose,
        currency,
        amountMinor,
        feeRateBps,
        feeMinor,
        totalMinor,
        escrowId: dto.escrowId ?? null,
        custodyId: dto.custodyId ?? null,
        adoptionId: dto.adoptionId ?? null,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      },
    });

    return mapQuote(quote);
  }

  // ─── Payments ──────────────────────────────────────────────────────────

  async createPayment(
    userId: string,
    dto: CreatePaymentDto,
  ): Promise<PaymentView> {
    const now = new Date();

    const payment = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.paymentQuote.findUnique({
        where: { id: dto.quoteId },
      });

      if (!quote || quote.userId !== userId) {
        throw new NotFoundException('Quote not found');
      }
      if (quote.consumedAt) {
        throw new ConflictException('Quote has already been used');
      }
      if (quote.expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException('Quote has expired');
      }

      const claimed = await tx.paymentQuote.updateMany({
        where: { id: quote.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Quote has already been used');
      }

      return tx.payment.create({
        data: {
          userId,
          purpose: quote.purpose,
          amountMinor: quote.totalMinor,
          currency: quote.currency,
          feeRateBps: quote.feeRateBps,
          feeMinor: quote.feeMinor,
          escrowId: quote.escrowId,
          custodyId: quote.custodyId,
          adoptionId: quote.adoptionId,
        },
      });
    });

    return mapPayment(payment);
  }

  async pay(
    actor: { userId: string; role: string },
    paymentId: string,
    dto: PayPaymentDto,
  ): Promise<PaymentView> {
    const payment = await this.loadOwnedPayment(actor, paymentId);

    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException(
        `Payment is ${payment.status} and cannot be paid again`,
      );
    }

    const charge = await this.provider.charge({
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      token: dto.providerToken,
    });

    if (!charge.succeeded) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
      await this.loggingService.log({
        level: 'WARN',
        action: 'PAYMENT_FAILED',
        message: `Payment ${payment.id} was declined by ${this.provider.name}`,
        userId: actor.userId,
        metadata: {
          paymentId: payment.id,
          amountMinor: payment.amountMinor.toString(),
          currency: payment.currency,
          failureReason: charge.failureReason ?? 'provider_declined',
        },
      });
      throw new BadRequestException({
        message: 'Payment was declined by the provider',
        code: 'PAYMENT_DECLINED',
      });
    }

    const paid = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          txHash: charge.txHash ?? null,
          externalRef: charge.externalRef ?? null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Payment is no longer pending');
      }

      const lines = this.principalLines(payment);
      assertLedgerBalanced(lines, payment.amountMinor);

      await tx.paymentLine.createMany({ data: lines });

      if (payment.escrowId) {
        await this.fundEscrow(tx, payment, actor.userId, charge.txHash);
      }

      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: paymentInclude,
      });
    });

    await this.loggingService.log({
      level: 'INFO',
      action: 'PAYMENT_PAID',
      message: `Payment ${payment.id} paid via ${this.provider.name}`,
      userId: actor.userId,
      metadata: {
        paymentId: payment.id,
        purpose: payment.purpose,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        txHash: charge.txHash ?? null,
        escrowId: payment.escrowId,
      },
    });

    return mapPayment(paid);
  }

  async complete(
    actor: { userId: string; role: string },
    paymentId: string,
    dto: CompletePaymentDto,
  ): Promise<PaymentView> {
    const payment = await this.loadOwnedPayment(actor, paymentId);

    if (payment.purpose !== PaymentPurpose.DEPOSIT) {
      throw new BadRequestException('Only DEPOSIT payments can be settled');
    }
    if (payment.status !== PaymentStatus.PAID) {
      throw new ConflictException(
        `Payment is ${payment.status} and cannot be settled`,
      );
    }
    if (payment.settledAt) {
      throw new ConflictException('Payment has already been settled');
    }

    const penaltyMinor = parseMinorUnits(dto.penaltyMinor ?? '0');
    const settlement = computeDepositSettlement(
      payment.amountMinor,
      payment.feeRateBps,
      penaltyMinor,
    );

    if (settlement.feeMinor !== payment.feeMinor) {
      throw new Error(
        `Fee snapshot mismatch for payment ${payment.id}: expected ${payment.feeMinor}, computed ${settlement.feeMinor}`,
      );
    }

    const lines = this.settlementLines(payment, settlement);
    assertLedgerBalanced(lines, payment.amountMinor);

    const settled = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PAID,
          settledAt: null,
        },
        data: {
          settlementRefundMinor: settlement.refundMinor,
          settlementPenaltyMinor: settlement.penaltyMinor,
          settlementFeeMinor: settlement.feeMinor,
          settledAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Payment is not in a settleable state');
      }

      await tx.paymentLine.createMany({ data: lines });

      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: paymentInclude,
      });
    });

    await this.loggingService.log({
      level: 'INFO',
      action: 'PAYMENT_SETTLED',
      message: `Deposit payment ${payment.id} settled`,
      userId: actor.userId,
      metadata: {
        paymentId: payment.id,
        amountMinor: payment.amountMinor.toString(),
        feeMinor: settlement.feeMinor.toString(),
        penaltyMinor: settlement.penaltyMinor.toString(),
        refundMinor: settlement.refundMinor.toString(),
        currency: payment.currency,
      },
    });

    return mapPayment(settled);
  }

  async refund(
    actor: { userId: string; role: string },
    paymentId: string,
    dto: RefundPaymentDto,
  ): Promise<PaymentView> {
    const payment = await this.loadOwnedPayment(actor, paymentId);

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new ConflictException(
        `Payment is ${payment.status} and cannot be refunded`,
      );
    }
    if (
      payment.purpose === PaymentPurpose.FEE ||
      payment.purpose === PaymentPurpose.REFUND
    ) {
      throw new BadRequestException('This payment purpose is not refundable');
    }
    if (
      payment.purpose === PaymentPurpose.DEPOSIT &&
      payment.settlementRefundMinor === null
    ) {
      throw new BadRequestException(
        'Deposit must be settled before it can be refunded',
      );
    }

    const amountMinor = parseMinorUnits(dto.amountMinor);
    if (amountMinor <= 0n) {
      throw new BadRequestException('amountMinor must be positive');
    }

    const cap = computeRefundCap({
      purpose: payment.purpose,
      amountMinor: payment.amountMinor,
      refundedAmountMinor: payment.refundedAmountMinor,
      settlementRefundMinor: payment.settlementRefundMinor,
    });

    if (amountMinor > cap) {
      throw new BadRequestException(
        `Refund exceeds the refundable balance of ${cap.toString()} minor units`,
      );
    }

    // `cap` is the remaining allowance; the SQL guard below has to compare the
    // resulting *total* against the absolute cap, or a second refund would be
    // rejected for double-counting the amount already refunded.
    const absoluteCap = payment.refundedAmountMinor + cap;

    const refundResult = await this.provider.refund({
      paymentId: payment.id,
      amountMinor,
      currency: payment.currency,
      token: dto.providerToken,
    });

    if (!refundResult.succeeded) {
      throw new BadRequestException({
        message: 'Refund was declined by the provider',
        code: 'REFUND_DECLINED',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional update keeps the cap true even under concurrent refunds:
      // the row lock serialises the check and the increment.
      const applied = await tx.$executeRaw`
        UPDATE "payments"
        SET "refunded_amount_minor" = "refunded_amount_minor" + ${amountMinor},
            "updated_at" = NOW()
        WHERE "id" = ${payment.id}
          AND "status" IN ('PAID'::"PaymentStatus", 'PARTIALLY_REFUNDED'::"PaymentStatus")
          AND "refunded_amount_minor" + ${amountMinor} <= ${absoluteCap}
      `;

      if (applied !== 1) {
        throw new BadRequestException('Refund exceeds the refundable balance');
      }

      const fresh = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const status =
        fresh.refundedAmountMinor >= fresh.amountMinor
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;

      await tx.payment.update({
        where: { id: payment.id },
        data: { status },
      });

      await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountMinor,
          currency: payment.currency,
          status: RefundStatus.COMPLETED,
          reason: dto.reason ?? null,
          externalRef: refundResult.externalRef ?? null,
          txHash: refundResult.txHash ?? null,
          createdById: actor.userId,
        },
      });

      const refundLines = this.refundLines(payment, amountMinor);
      assertLedgerBalanced(refundLines, amountMinor);
      await tx.paymentLine.createMany({ data: refundLines });

      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: paymentInclude,
      });
    });

    await this.loggingService.log({
      level: 'INFO',
      action: 'PAYMENT_REFUNDED',
      message: `Refund of ${amountMinor.toString()} minor units issued for payment ${payment.id}`,
      userId: actor.userId,
      metadata: {
        paymentId: payment.id,
        amountMinor: amountMinor.toString(),
        currency: payment.currency,
        txHash: refundResult.txHash ?? null,
      },
    });

    return mapPayment(updated);
  }

  // ─── Reads ─────────────────────────────────────────────────────────────

  async getPayment(
    actor: { userId: string; role: string },
    paymentId: string,
  ): Promise<PaymentView> {
    const payment = await this.loadOwnedPayment(actor, paymentId);
    const detailed = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: paymentInclude,
    });
    return mapPayment(detailed);
  }

  async listPayments(
    userId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentPageView> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = this.decodeCursor(query.cursor);

    const payments = await this.prisma.payment.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = payments.length > limit;
    const page = hasMore ? payments.slice(0, limit) : payments;
    const nextCursor = hasMore
      ? this.encodeCursor(page[page.length - 1])
      : null;

    return {
      data: page.map((payment) => mapPayment(payment)),
      nextCursor,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private get feeRateBps(): number {
    return this.config.get<number>('payments.feeRateBps', DEFAULT_FEE_RATE_BPS);
  }

  private feeForPurpose(
    purpose: PaymentPurpose,
    amountMinor: bigint,
    feeRateBps: number,
  ): bigint {
    switch (purpose) {
      case PaymentPurpose.DEPOSIT:
        // The fee is carved out of the deposit at settlement time.
        return multiplyBpsRoundHalfUp(amountMinor, feeRateBps);
      case PaymentPurpose.FEE:
        // The payment *is* the fee.
        return amountMinor;
      default:
        return 0n;
    }
  }

  private async loadOwnedPayment(
    actor: { userId: string; role: string },
    paymentId: string,
  ): Promise<PaymentWithRelations> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: paymentInclude,
    });

    // Non-owners get 404 to avoid disclosing that the payment exists.
    if (
      !payment ||
      (payment.userId !== actor.userId && actor.role !== 'ADMIN')
    ) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  private async assertEntityLinks(
    userId: string,
    dto: CreateQuoteDto,
  ): Promise<void> {
    const links = [dto.escrowId, dto.custodyId, dto.adoptionId].filter(
      (value): value is string => Boolean(value),
    );
    if (links.length > 1) {
      throw new BadRequestException(
        'At most one of escrowId, custodyId or adoptionId may be provided',
      );
    }

    if (dto.adoptionId) {
      const adoption = await this.prisma.adoption.findUnique({
        where: { id: dto.adoptionId },
        select: { adopterId: true, ownerId: true },
      });
      if (!adoption) {
        throw new NotFoundException('Adoption not found');
      }
      if (adoption.adopterId !== userId && adoption.ownerId !== userId) {
        throw new ForbiddenException('You are not a party to this adoption');
      }
    }

    if (dto.custodyId) {
      const custody = await this.prisma.custody.findUnique({
        where: { id: dto.custodyId },
        select: {
          holderId: true,
          pet: { select: { currentOwnerId: true } },
        },
      });
      if (!custody) {
        throw new NotFoundException('Custody not found');
      }
      if (
        custody.holderId !== userId &&
        custody.pet?.currentOwnerId !== userId
      ) {
        throw new ForbiddenException('You are not a party to this custody');
      }
    }

    if (dto.escrowId) {
      const escrow = await this.prisma.escrow.findUnique({
        where: { id: dto.escrowId },
        select: { id: true },
      });
      if (!escrow) {
        throw new NotFoundException('Escrow not found');
      }
    }
  }

  private principalLines(
    payment: Payment,
  ): Prisma.PaymentLineCreateManyInput[] {
    switch (payment.purpose) {
      case PaymentPurpose.DEPOSIT:
        return [
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.USER_WALLET,
            PaymentLineDirection.DEBIT,
            PaymentLineType.PRINCIPAL,
            payment.amountMinor,
            'Deposit paid by user',
          ),
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.ESCROW,
            PaymentLineDirection.CREDIT,
            PaymentLineType.PRINCIPAL,
            payment.amountMinor,
            'Deposit held in escrow',
          ),
        ];
      case PaymentPurpose.FEE:
        return [
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.USER_WALLET,
            PaymentLineDirection.DEBIT,
            PaymentLineType.FEE,
            payment.amountMinor,
            'Platform fee paid by user',
          ),
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.PLATFORM_FEE,
            PaymentLineDirection.CREDIT,
            PaymentLineType.FEE,
            payment.amountMinor,
            'Platform fee revenue',
          ),
        ];
      case PaymentPurpose.TOPUP:
        return [
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.PROVIDER_CLEARING,
            PaymentLineDirection.DEBIT,
            PaymentLineType.PRINCIPAL,
            payment.amountMinor,
            'Funds received from provider',
          ),
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.USER_WALLET,
            PaymentLineDirection.CREDIT,
            PaymentLineType.PRINCIPAL,
            payment.amountMinor,
            'Wallet topped up',
          ),
        ];
      default:
        return [
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.REFUND_PAYABLE,
            PaymentLineDirection.DEBIT,
            PaymentLineType.PRINCIPAL,
            payment.amountMinor,
            'Refund issued',
          ),
          this.ledgerLine(
            payment,
            LEDGER_ACCOUNTS.USER_WALLET,
            PaymentLineDirection.CREDIT,
            PaymentLineType.PRINCIPAL,
            payment.amountMinor,
            'Refund credited to user',
          ),
        ];
    }
  }

  private settlementLines(
    payment: Payment,
    settlement: DepositSettlement,
  ): Prisma.PaymentLineCreateManyInput[] {
    const lines: Prisma.PaymentLineCreateManyInput[] = [
      this.ledgerLine(
        payment,
        LEDGER_ACCOUNTS.ESCROW,
        PaymentLineDirection.DEBIT,
        PaymentLineType.PRINCIPAL,
        settlement.depositMinor,
        'Deposit released from escrow',
      ),
    ];

    if (settlement.refundMinor > 0n) {
      lines.push(
        this.ledgerLine(
          payment,
          LEDGER_ACCOUNTS.USER_WALLET,
          PaymentLineDirection.CREDIT,
          PaymentLineType.REFUND,
          settlement.refundMinor,
          'Refund payable to user',
        ),
      );
    }
    if (settlement.penaltyMinor > 0n) {
      lines.push(
        this.ledgerLine(
          payment,
          LEDGER_ACCOUNTS.PENALTY,
          PaymentLineDirection.CREDIT,
          PaymentLineType.PENALTY,
          settlement.penaltyMinor,
          'Penalty withheld from deposit',
        ),
      );
    }
    if (settlement.feeMinor > 0n) {
      lines.push(
        this.ledgerLine(
          payment,
          LEDGER_ACCOUNTS.PLATFORM_FEE,
          PaymentLineDirection.CREDIT,
          PaymentLineType.FEE,
          settlement.feeMinor,
          'Platform fee retained',
        ),
      );
    }

    return lines;
  }

  private refundLines(
    payment: Payment,
    amountMinor: bigint,
  ): Prisma.PaymentLineCreateManyInput[] {
    return [
      this.ledgerLine(
        payment,
        LEDGER_ACCOUNTS.REFUND_PAYABLE,
        PaymentLineDirection.DEBIT,
        PaymentLineType.REFUND,
        amountMinor,
        'Refund paid out',
      ),
      this.ledgerLine(
        payment,
        LEDGER_ACCOUNTS.USER_WALLET,
        PaymentLineDirection.CREDIT,
        PaymentLineType.REFUND,
        amountMinor,
        'Refund credited to user',
      ),
    ];
  }

  private ledgerLine(
    payment: Payment,
    account: string,
    direction: PaymentLineDirection,
    type: PaymentLineType,
    amountMinor: bigint,
    description: string,
  ): Prisma.PaymentLineCreateManyInput {
    return {
      paymentId: payment.id,
      account,
      direction,
      type,
      amountMinor,
      currency: payment.currency,
      description,
    };
  }

  private async fundEscrow(
    tx: Prisma.TransactionClient,
    payment: Payment,
    actorId: string,
    txHash?: string,
  ): Promise<void> {
    const escrow = await tx.escrow.findUnique({
      where: { id: payment.escrowId as string },
      select: { id: true, status: true },
    });

    if (!escrow) {
      throw new NotFoundException('Linked escrow not found');
    }
    if (escrow.status === EscrowStatus.CREATED) {
      await tx.escrow.update({
        where: { id: escrow.id },
        data: {
          status: EscrowStatus.FUNDED,
          fundingTxHash: txHash ?? null,
        },
      });
    } else if (escrow.status !== EscrowStatus.FUNDED) {
      throw new ConflictException(
        `Escrow is ${escrow.status} and cannot be funded`,
      );
    }

    await tx.eventLog.create({
      data: {
        entityType: EventEntityType.ESCROW,
        entityId: escrow.id,
        eventType: EventType.ESCROW_FUNDED,
        actorId,
        txHash: txHash ?? null,
        payload: {
          paymentId: payment.id,
          amountMinor: payment.amountMinor.toString(),
          currency: payment.currency,
        },
      },
    });
  }

  private encodeCursor(payment: Payment): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: payment.createdAt.toISOString(),
        id: payment.id,
      }),
    ).toString('base64url');
  }

  private decodeCursor(cursor?: string): PaymentCursor | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { createdAt?: unknown; id?: unknown };

      if (
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.id !== 'string'
      ) {
        throw new Error('Malformed cursor');
      }

      const createdAt = new Date(parsed.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        throw new Error('Malformed cursor date');
      }

      return { createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}
