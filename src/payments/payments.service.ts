import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { Money, toMoney } from './utils/money';

/** A refund may only be requested within this window after the payment. */
export const REFUND_WINDOW_DAYS = 30;

export interface PaymentRequester {
  id: string;
  role?: string;
}

export interface Refundability {
  eligible: boolean;
  remainingAmountMinor: number;
  remaining: Money;
  reason?: string;
  openRequestId?: string;
}

export const PAYMENT_DETAIL_INCLUDE = {
  lines: { orderBy: { createdAt: 'asc' as const } },
  refundRequests: { orderBy: { createdAt: 'desc' as const } },
  escrow: {
    select: {
      id: true,
      status: true,
      adoption: { select: { id: true } },
      custody: { select: { id: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

export const PAYMENT_WITH_REFUNDS_INCLUDE = {
  refundRequests: true,
} satisfies Prisma.PaymentInclude;

export type PaymentDetail = Prisma.PaymentGetPayload<{
  include: typeof PAYMENT_DETAIL_INCLUDE;
}>;

export type PaymentForRefund = Prisma.PaymentGetPayload<{
  include: typeof PAYMENT_WITH_REFUNDS_INCLUDE;
}>;

/**
 * Eligibility rules for refunds, shared by the detail endpoint and the
 * refund request flow so both always agree on the `refundable` flag.
 */
export function computeRefundability(
  payment: {
    status: string;
    amountMinor: number;
    refundedAmountMinor: number;
    currency: string;
    paidAt: Date | null;
    refundRequests?: Array<{ id: string; status: string }>;
  },
  now: Date = new Date(),
): Refundability {
  const remainingAmountMinor =
    payment.amountMinor - payment.refundedAmountMinor;
  const openRequest = payment.refundRequests?.find(
    (request) => request.status === 'PENDING',
  );

  const base = {
    remainingAmountMinor,
    remaining: toMoney(remainingAmountMinor, payment.currency),
    ...(openRequest ? { openRequestId: openRequest.id } : {}),
  };

  if (
    payment.status !== 'SUCCEEDED' &&
    payment.status !== 'PARTIALLY_REFUNDED'
  ) {
    return {
      eligible: false,
      reason: `Payment is ${payment.status.toLowerCase()} and cannot be refunded`,
      ...base,
    };
  }

  if (remainingAmountMinor <= 0) {
    return {
      eligible: false,
      reason: 'Payment has already been fully refunded',
      ...base,
    };
  }

  if (!payment.paidAt) {
    return {
      eligible: false,
      reason: 'Payment has not been settled yet',
      ...base,
    };
  }

  const windowEndsAt = new Date(
    payment.paidAt.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  if (now > windowEndsAt) {
    return {
      eligible: false,
      reason: `The ${REFUND_WINDOW_DAYS}-day refund window has closed`,
      ...base,
    };
  }

  if (openRequest) {
    return {
      eligible: false,
      reason: 'A refund request for this payment is already under review',
      ...base,
    };
  }

  return { eligible: true, ...base };
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists payments. Regular users only ever see payments they paid or
   * received; admins see everything.
   */
  async listPayments(requester: PaymentRequester, query: ListPaymentsDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const where: Prisma.PaymentWhereInput = {};

    if (requester.role !== 'ADMIN') {
      where.OR = [{ payerId: requester.id }, { payeeId: requester.id }];
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return new PaginatedResponseDto(
      payments.map((payment) => ({
        id: payment.id,
        status: payment.status,
        amount: toMoney(payment.amountMinor, payment.currency),
        refundedAmount: toMoney(payment.refundedAmountMinor, payment.currency),
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      })),
      new PaginationMetaDto(page, limit, total),
    );
  }

  /**
   * Payment detail with line items, the related agreement and a
   * server-computed `refundable` flag. Another user's payment is reported as
   * 404 so its existence is never disclosed.
   */
  async getPayment(paymentId: string, requester: PaymentRequester) {
    const payment = (await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: PAYMENT_DETAIL_INCLUDE,
    })) as PaymentDetail | null;

    if (!payment || !this.canAccess(payment, requester)) {
      throw new NotFoundException('Payment not found');
    }

    return this.toDetail(payment);
  }

  /**
   * Internal helper used by settlement flows to record a payment. Not exposed
   * over HTTP from this module.
   */
  async recordPayment(input: {
    payerId: string;
    payeeId?: string | null;
    amountMinor: number;
    currency?: string;
    status?: Prisma.PaymentCreateInput['status'];
    escrowId?: string | null;
    paidAt?: Date | null;
    lines?: Array<{
      kind: Prisma.PaymentLineCreateWithoutPaymentInput['kind'];
      label: string;
      amountMinor: number;
    }>;
  }) {
    return this.prisma.payment.create({
      data: {
        payerId: input.payerId,
        payeeId: input.payeeId ?? null,
        amountMinor: input.amountMinor,
        currency: input.currency ?? 'XLM',
        status: input.status ?? 'PENDING',
        escrowId: input.escrowId ?? null,
        paidAt: input.paidAt ?? null,
        lines: input.lines?.length ? { create: input.lines } : undefined,
      },
      include: { lines: true },
    });
  }

  private canAccess(payment: PaymentDetail, requester: PaymentRequester) {
    if (requester.role === 'ADMIN') return true;
    return payment.payerId === requester.id || payment.payeeId === requester.id;
  }

  private toDetail(payment: PaymentDetail) {
    const relatedEntity = payment.escrow?.adoption
      ? { type: 'ADOPTION' as const, id: payment.escrow.adoption.id }
      : payment.escrow?.custody
        ? { type: 'CUSTODY' as const, id: payment.escrow.custody.id }
        : null;

    const refundable = computeRefundability(payment);

    return {
      id: payment.id,
      status: payment.status,
      amount: toMoney(payment.amountMinor, payment.currency),
      refundedAmount: toMoney(payment.refundedAmountMinor, payment.currency),
      remainingAmount: refundable.remaining,
      refundable,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      relatedEntity,
      lines: payment.lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        label: line.label,
        amount: toMoney(line.amountMinor, payment.currency),
      })),
      refundRequests: payment.refundRequests.map((request) => ({
        id: request.id,
        status: request.status,
        reason: request.reason,
        requestedAmount: request.requestedAmountMinor
          ? toMoney(request.requestedAmountMinor, payment.currency)
          : null,
        approvedAmount: request.approvedAmountMinor
          ? toMoney(request.approvedAmountMinor, payment.currency)
          : null,
        decisionReason: request.decisionReason,
        decidedAt: request.decidedAt,
        createdAt: request.createdAt,
      })),
    };
  }
}
