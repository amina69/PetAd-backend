import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentLedgerEntryType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const toAmount = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
};

export interface LedgerEntryInput {
  type: PaymentLedgerEntryType;
  amount: number;
  currency: string;
  escrowId?: string;
  feeScheduleId?: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaymentLedgerService {
  private readonly logger = new Logger(PaymentLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: LedgerEntryInput,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    try {
      return await client.paymentLedgerEntry.create({
        data: {
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          escrowId: input.escrowId,
          feeScheduleId: input.feeScheduleId,
          occurredAt: input.occurredAt ?? new Date(),
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // The unique (type, escrowId) index makes settlement replay-safe.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(
          `Ledger entry ${input.type} for escrow ${input.escrowId} already recorded`,
        );
        return client.paymentLedgerEntry.findFirst({
          where: { type: input.type, escrowId: input.escrowId },
        });
      }
      throw error;
    }
  }

  async recordFee(
    input: Omit<LedgerEntryInput, 'type'>,
    client?: Prisma.TransactionClient | PrismaService,
  ) {
    return this.record(
      { ...input, type: PaymentLedgerEntryType.FEE_COLLECTED },
      client,
    );
  }

  /** Record a refund only when the matching fee was actually collected. */
  async recordRefund(
    input: Omit<LedgerEntryInput, 'type'>,
    client?: Prisma.TransactionClient | PrismaService,
  ) {
    if (!input.escrowId) return null;
    const entryClient = client ?? this.prisma;
    const collected = await entryClient.paymentLedgerEntry.findFirst({
      where: {
        type: PaymentLedgerEntryType.FEE_COLLECTED,
        escrowId: input.escrowId,
      },
    });
    if (!collected) return null;

    return this.record(
      {
        ...input,
        amount: toAmount(collected.amount),
        type: PaymentLedgerEntryType.FEE_REFUNDED,
      },
      entryClient,
    );
  }

  async findEntries(from: Date, to: Date) {
    return this.prisma.paymentLedgerEntry.findMany({
      where: { occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: 'asc' },
    });
  }
}
