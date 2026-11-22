import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { computeRefundability, REFUND_WINDOW_DAYS } from '../payments.service';
import { toMoney } from '../utils/money';
import { SettlementService } from './settlement.service';
import {
  ApproveRefundDto,
  CreateRefundRequestDto,
  DenyRefundDto,
} from '../dto/refund-request.dto';

const MIN_REQUEST_REASON_LENGTH = 20;
const MIN_DECISION_REASON_LENGTH = 10;

/**
 * Refund requests and admin decisions.
 *
 * Every state change runs inside a transaction holding a PostgreSQL advisory
 * lock for the payment, so concurrent requests/decisions for the same payment
 * serialize. On top of that the accumulated refund is written with a
 * conditional `updateMany` that can only succeed while the balance is still
 * sufficient — this is what makes "never refund more than was paid" hold even
 * if the lock is bypassed by a direct writer.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly settlement: SettlementService,
    private readonly notifications: NotificationsService,
  ) {}

  async createRequest(
    paymentId: string,
    requesterId: string,
    dto: CreateRefundRequestDto,
  ) {
    const reason = this.normaliseReason(dto.reason, MIN_REQUEST_REASON_LENGTH);

    const created = await this.withPaymentLock(paymentId, async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { refundRequests: true },
      });

      // Only the payer can ask for their money back, and another user's
      // payment must not be disclosed.
      if (!payment || payment.payerId !== requesterId) {
        throw new NotFoundException('Payment not found');
      }

      const eligibility = computeRefundability(payment);

      if (!eligibility.eligible) {
        throw new ConflictException({
          code: 'PAYMENT_NOT_REFUNDABLE',
          message:
            eligibility.reason ??
            `Payment can only be refunded within ${REFUND_WINDOW_DAYS} days`,
        });
      }

      const requestedAmountMinor =
        dto.amountMinor ?? eligibility.remainingAmountMinor;

      if (
        !Number.isInteger(requestedAmountMinor) ||
        requestedAmountMinor < 1 ||
        requestedAmountMinor > eligibility.remainingAmountMinor
      ) {
        throw new BadRequestException({
          code: 'INVALID_REFUND_AMOUNT',
          message:
            'Refund amount must be a whole number of minor units between 1 ' +
            `and ${eligibility.remainingAmountMinor}`,
        });
      }

      const request = await tx.refundRequest.create({
        data: {
          paymentId,
          requesterId,
          reason,
          requestedAmountMinor,
        },
      });

      return { request, currency: payment.currency };
    });

    await this.events.logEvent({
      entityType: 'PAYMENT',
      entityId: paymentId,
      eventType: 'REFUND_REQUESTED',
      actorId: requesterId,
      payload: {
        refundRequestId: created.request.id,
        requestedAmountMinor: created.request.requestedAmountMinor,
      },
    });

    await this.notifications.notifyUser(requesterId, {
      subject: 'Refund request received',
      text:
        `We received your refund request for ${this.formatAmount(
          created.request.requestedAmountMinor ?? 0,
          created.currency,
        )}. ` + 'You will be notified once an administrator reviews it.',
    });

    return this.toView(created.request, created.currency);
  }

  /**
   * Approves a pending request. Omitting `amountMinor` approves the requested
   * amount; a smaller amount is recorded as a partial approval.
   */
  async approve(requestId: string, adminId: string, dto: ApproveRefundDto) {
    const decisionReason = this.normaliseReason(
      dto.reason,
      MIN_DECISION_REASON_LENGTH,
    );

    const paymentId = await this.findPaymentId(requestId);

    const outcome = await this.withPaymentLock(paymentId, async (tx) => {
      const request = await tx.refundRequest.findUnique({
        where: { id: requestId },
        include: { payment: true },
      });

      if (!request) {
        throw new NotFoundException('Refund request not found');
      }

      if (request.status !== 'PENDING') {
        throw new ConflictException({
          code: 'REFUND_REQUEST_ALREADY_DECIDED',
          message: `Refund request is already ${request.status.toLowerCase()}`,
        });
      }

      const payment = request.payment;
      const remaining = payment.amountMinor - payment.refundedAmountMinor;
      const requested = request.requestedAmountMinor ?? remaining;
      const amountMinor = dto.amountMinor ?? requested;

      if (!Number.isInteger(amountMinor) || amountMinor < 1) {
        throw new BadRequestException({
          code: 'INVALID_REFUND_AMOUNT',
          message:
            'Refund amount must be a positive whole number of minor units',
        });
      }

      if (amountMinor > remaining) {
        throw new ConflictException({
          code: 'REFUND_EXCEEDS_BALANCE',
          message: `Refund of ${amountMinor} exceeds the remaining refundable balance of ${remaining}`,
        });
      }

      // Concurrency guard: the increment only lands while the paid-minus-
      // refunded balance still covers it.
      const reservation = await tx.payment.updateMany({
        where: {
          id: payment.id,
          refundedAmountMinor: { lte: payment.amountMinor - amountMinor },
        },
        data: { refundedAmountMinor: { increment: amountMinor } },
      });

      if (reservation.count === 0) {
        throw new ConflictException({
          code: 'REFUND_EXCEEDS_BALANCE',
          message:
            'Another refund consumed the remaining balance; the request was not approved',
        });
      }

      const refundedAmountMinor = payment.refundedAmountMinor + amountMinor;
      const fullyRefunded = refundedAmountMinor >= payment.amountMinor;

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      });

      const updatedRequest = await tx.refundRequest.update({
        where: { id: requestId },
        data: {
          status: amountMinor < requested ? 'PARTIALLY_APPROVED' : 'APPROVED',
          approvedAmountMinor: amountMinor,
          decidedById: adminId,
          decisionReason,
          decidedAt: new Date(),
        },
      });

      return {
        request: updatedRequest,
        payment: updatedPayment,
        amountMinor,
        requestedAmountMinor: requested,
        payerId: payment.payerId,
      };
    });

    const settlement = await this.settlement.settleRefund({
      paymentId,
      escrowId: outcome.payment.escrowId,
      amountMinor: outcome.amountMinor,
      currency: outcome.payment.currency,
      refundRequestId: requestId,
    });

    await this.events.logEvent({
      entityType: 'PAYMENT',
      entityId: paymentId,
      eventType: 'PAYMENT_REFUNDED',
      actorId: adminId,
      payload: {
        refundRequestId: requestId,
        approvedAmountMinor: outcome.amountMinor,
        refundedAmountMinor: outcome.payment.refundedAmountMinor,
        rail: settlement.rail,
        status: outcome.payment.status,
      },
    });

    await this.events.logEvent({
      entityType: 'PAYMENT',
      entityId: paymentId,
      eventType: 'REFUND_APPROVED',
      actorId: adminId,
      payload: {
        refundRequestId: requestId,
        partial: outcome.amountMinor < outcome.requestedAmountMinor,
        reason: decisionReason,
      },
    });

    await this.notifications.notifyUser(outcome.payerId, {
      subject: 'Refund request approved',
      text:
        `Your refund request was approved for ${this.formatAmount(
          outcome.amountMinor,
          outcome.payment.currency,
        )}. ` + `Reason: ${decisionReason}`,
    });

    return {
      ...this.toView(outcome.request, outcome.payment.currency),
      payment: {
        id: outcome.payment.id,
        status: outcome.payment.status,
        amount: toMoney(outcome.payment.amountMinor, outcome.payment.currency),
        refundedAmount: toMoney(
          outcome.payment.refundedAmountMinor,
          outcome.payment.currency,
        ),
      },
      settlement,
    };
  }

  async deny(requestId: string, adminId: string, dto: DenyRefundDto) {
    const decisionReason = this.normaliseReason(
      dto.reason,
      MIN_DECISION_REASON_LENGTH,
    );

    const paymentId = await this.findPaymentId(requestId);

    const denied = await this.withPaymentLock(paymentId, async (tx) => {
      const request = await tx.refundRequest.findUnique({
        where: { id: requestId },
        include: { payment: true },
      });

      if (!request) {
        throw new NotFoundException('Refund request not found');
      }

      if (request.status !== 'PENDING') {
        throw new ConflictException({
          code: 'REFUND_REQUEST_ALREADY_DECIDED',
          message: `Refund request is already ${request.status.toLowerCase()}`,
        });
      }

      return tx.refundRequest.update({
        where: { id: requestId },
        data: {
          status: 'DENIED',
          decidedById: adminId,
          decisionReason,
          decidedAt: new Date(),
        },
        include: { payment: true },
      });
    });

    await this.events.logEvent({
      entityType: 'PAYMENT',
      entityId: paymentId,
      eventType: 'REFUND_DENIED',
      actorId: adminId,
      payload: {
        refundRequestId: requestId,
        reason: decisionReason,
      },
    });

    await this.notifications.notifyUser(denied.payment.payerId, {
      subject: 'Refund request denied',
      text: `Your refund request was denied. Reason: ${decisionReason}`,
    });

    return this.toView(denied, denied.payment.currency);
  }

  private async findPaymentId(requestId: string): Promise<string> {
    const request = await this.prisma.refundRequest.findUnique({
      where: { id: requestId },
      select: { paymentId: true },
    });

    if (!request) {
      throw new NotFoundException('Refund request not found');
    }

    return request.paymentId;
  }

  private async withPaymentLock<T>(
    paymentId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
      return work(tx);
    });
  }

  private normaliseReason(reason: string, minLength: number): string {
    const trimmed = (reason ?? '').trim();

    if (trimmed.length < minLength) {
      throw new BadRequestException(
        `A reason of at least ${minLength} characters is required`,
      );
    }

    return trimmed;
  }

  private formatAmount(amountMinor: number, currency: string): string {
    return `${amountMinor} ${currency} (minor units)`;
  }

  private toView(
    request: {
      id: string;
      paymentId: string;
      status: string;
      reason: string;
      requestedAmountMinor: number | null;
      approvedAmountMinor: number | null;
      decisionReason: string | null;
      decidedAt: Date | null;
      createdAt: Date;
    },
    currency: string,
  ) {
    return {
      id: request.id,
      paymentId: request.paymentId,
      status: request.status,
      reason: request.reason,
      requestedAmount:
        request.requestedAmountMinor !== null
          ? toMoney(request.requestedAmountMinor, currency)
          : null,
      approvedAmount:
        request.approvedAmountMinor !== null
          ? toMoney(request.approvedAmountMinor, currency)
          : null,
      decisionReason: request.decisionReason,
      decidedAt: request.decidedAt,
      createdAt: request.createdAt,
    };
  }
}
