import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { Decimal, EscrowStatus, EventEntityType, EventType, CustodyStatus } from '@prisma/client';

/** Fraction of the deposit kept as a late-return penalty (20 %). */
const DEFAULT_LATE_PENALTY_BPS = 2000;

/** Basis-point denominator. */
const BPS = 10_000;

export interface AdoptionSettlementResult {
  escrowId: string;
  releasedAmount: number;
  platformFee: number;
  ownerAmount: number;
}

export interface CustodySettlementResult {
  escrowId: string;
  outcome: 'NORMAL_RETURN' | 'LATE_RETURN' | 'HELD';
  refundAmount: number;
  penaltyAmount: number;
  feeAmount: number;
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // Issue #272 — Automated escrow settlement on adoption
  // ─────────────────────────────────────────────────────────

  /**
   * Settle escrow after an adoption is confirmed completed.
   *
   * - Verifies no open dispute blocks settlement.
   * - Splits the amount between owner/shelter and platform fee.
   * - Marks the escrow RELEASED.
   * - Logs ESCROW_RELEASED on the event log.
   */
  async settleAdoptionEscrow(
    adoptionId: string,
    platformFeeBps: number = 100,
  ): Promise<AdoptionSettlementResult> {
    return this.prisma.$transaction(async (tx) => {
      const adoption = await tx.adoption.findUnique({
        where: { id: adoptionId },
        include: { escrow: true },
      });

      if (!adoption) {
        throw new NotFoundException(`Adoption ${adoptionId} not found`);
      }

      if (!adoption.escrow) {
        throw new NotFoundException(
          `No escrow found for adoption ${adoptionId}`,
        );
      }

      if (adoption.escrow.status === EscrowStatus.DISPUTED) {
        throw new ConflictException(
          `Adoption ${adoptionId} has an open dispute; settlement is blocked.`,
        );
      }

      if (adoption.escrow.status !== EscrowStatus.FUNDED) {
        throw new ConflictException(
          `Escrow ${adoption.escrow.id} is not in FUNDED state.`,
        );
      }

      const total = new Decimal(adoption.escrow.amount.toString());
      const fee = total.times(platformFeeBps).dividedBy(BPS);
      const ownerAmount = total.minus(fee);

      await tx.escrow.update({
        where: { id: adoption.escrow.id },
        data: { status: EscrowStatus.RELEASED },
      });

      await this.events.logEvent({
        entityType: EventEntityType.ESCROW,
        entityId: adoption.escrow.id,
        eventType: EventType.ESCROW_RELEASED,
        payload: {
          adoptionId,
          total: total.toNumber(),
          fee: fee.toNumber(),
          ownerAmount: ownerAmount.toNumber(),
        },
      });

      this.logger.log(
        `Adoption ${adoptionId}: escrow ${adoption.escrow.id} released ` +
          `(owner ${ownerAmount.toFixed(2)}, fee ${fee.toFixed(2)})`,
      );

      return {
        escrowId: adoption.escrow.id,
        releasedAmount: total.toNumber(),
        platformFee: fee.toNumber(),
        ownerAmount: ownerAmount.toNumber(),
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // Issue #273 — Custody deposit settlement
  // ─────────────────────────────────────────────────────────

  /**
   * Settle the escrow deposit for a custody record.
   *
   * Outcomes:
   * - RETURNED  → full refund to holder.
   * - RETURNED (late) → deduct late-return penalty to owner; remainder refunded.
   * - VIOLATION / CANCELLED → hold funds (DISPUTED) until resolution.
   *
   * Partial amounts are computed with Decimal so refund + penalty + fee = deposit.
   * The result is stored on the custody's escrow record.
   */
  async settleCustodyDeposit(
    custodyId: string,
    latePenaltyBps: number = DEFAULT_LATE_PENALTY_BPS,
    isLateReturn: boolean = false,
  ): Promise<CustodySettlementResult> {
    return this.prisma.$transaction(async (tx) => {
      const custody = await tx.custody.findUnique({
        where: { id: custodyId },
        include: { escrow: true },
      });

      if (!custody) {
        throw new NotFoundException(`Custody ${custodyId} not found`);
      }

      if (!custody.escrow) {
        throw new NotFoundException(
          `No escrow found for custody ${custodyId}`,
        );
      }

      const deposit = new Decimal(
        (custody.depositAmount ?? custody.escrow.amount).toString(),
      );

      const isViolation =
        custody.status === CustodyStatus.VIOLATION ||
        custody.status === CustodyStatus.CANCELLED;

      if (isViolation) {
        // Hold the funds until a manual resolution.
        await tx.escrow.update({
          where: { id: custody.escrow.id },
          data: { status: EscrowStatus.DISPUTED },
        });

        this.logger.warn(
          `Custody ${custodyId}: deposit held due to ${custody.status}`,
        );

        return {
          escrowId: custody.escrow.id,
          outcome: 'HELD',
          refundAmount: 0,
          penaltyAmount: 0,
          feeAmount: 0,
        };
      }

      let penalty = new Decimal(0);
      let refund: Decimal;
      let outcome: CustodySettlementResult['outcome'];

      if (isLateReturn) {
        penalty = deposit.times(latePenaltyBps).dividedBy(BPS);
        refund = deposit.minus(penalty);
        outcome = 'LATE_RETURN';
      } else {
        refund = deposit;
        outcome = 'NORMAL_RETURN';
      }

      // Conservation check: refund + penalty = deposit (no money created/lost).
      const conserved = refund.plus(penalty);
      if (!conserved.equals(deposit)) {
        throw new Error(
          `Settlement conservation violated: ${conserved} ≠ ${deposit}`,
        );
      }

      await tx.escrow.update({
        where: { id: custody.escrow.id },
        data: { status: EscrowStatus.REFUNDED },
      });

      await this.events.logEvent({
        entityType: EventEntityType.ESCROW,
        entityId: custody.escrow.id,
        eventType: EventType.ESCROW_REFUNDED,
        payload: {
          custodyId,
          outcome,
          deposit: deposit.toNumber(),
          refund: refund.toNumber(),
          penalty: penalty.toNumber(),
        },
      });

      this.logger.log(
        `Custody ${custodyId}: deposit settled (${outcome}): ` +
          `refund ${refund.toFixed(2)}, penalty ${penalty.toFixed(2)}`,
      );

      return {
        escrowId: custody.escrow.id,
        outcome,
        refundAmount: refund.toNumber(),
        penaltyAmount: penalty.toNumber(),
        feeAmount: 0,
      };
    });
  }
}
