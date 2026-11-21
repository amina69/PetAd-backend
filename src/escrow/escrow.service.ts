import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  EscrowStatus,
  AdoptionStatus,
  EventEntityType,
  EventType,
  Prisma,
} from '@prisma/client';
import { AdoptionStateMachine } from '../adoption/services/adoption-state-machine.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { PetStatus } from '../common/enums/pet-status.enum';
import { FeeCalculationService } from '../payments/fees/fee-calculation.service';
import { FeeScheduleService } from '../payments/fees/fee-schedule.service';
import { PaymentLedgerService } from '../payments/ledger/payment-ledger.service';

@Injectable()
export class EscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly adoptionStateMachine: AdoptionStateMachine,
    private readonly petAvailabilityService: PetAvailabilityService,
    private readonly feeCalculation: FeeCalculationService,
    private readonly feeSchedules: FeeScheduleService,
    private readonly ledger: PaymentLedgerService,
  ) {}

  async createEscrow(amount: number, tx?: Prisma.TransactionClient) {
    const prismaClient = tx || this.prisma;

    // Generate Stellar keypair placeholders
    // In a real implementation, this would use the Stellar SDK
    const stellarPublicKey = `ESCROW_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const stellarSecretEncrypted = `ENCRYPTED_SECRET_${Date.now()}`;

    // Pin the fee version now so later schedule changes cannot alter this
    // agreement's settlement. Legacy databases may have no schedule yet.
    const schedule = await this.feeSchedules.findEffective(new Date());

    return prismaClient.escrow.create({
      data: {
        stellarPublicKey,
        stellarSecretEncrypted,
        amount,
        status: 'CREATED',
        feeScheduleId: schedule?.id ?? null,
      },
    });
  }

  async releaseEscrow(escrowId: string, txHash?: string) {
    return this.prisma.$transaction(async (tx) => {
      const escrow = await tx.escrow.findUnique({
        where: { id: escrowId },
        include: { adoption: { include: { pet: true } } },
      });

      if (!escrow) {
        throw new NotFoundException('Escrow not found');
      }

      // 1. Update Escrow Status
      const updatedEscrow = await tx.escrow.update({
        where: { id: escrowId },
        data: {
          status: EscrowStatus.RELEASED,
          releaseTxHash: txHash,
        },
      });

      await this.events.logEvent({
        entityType: EventEntityType.ESCROW,
        entityId: escrowId,
        eventType: EventType.ESCROW_RELEASED,
        txHash,
        payload: { amount: Number(escrow.amount) },
      });

      const schedule = await this.feeCalculation.resolveForAgreement(
        escrow.feeScheduleId,
        escrow.createdAt,
      );
      const settlement = this.feeCalculation.calculate({
        schedule,
        amount: Number(escrow.amount),
        currency: escrow.assetCode,
        species: escrow.adoption?.pet?.species,
      });
      await this.ledger.recordFee(
        {
          amount: settlement.total,
          currency: settlement.currency,
          escrowId,
          feeScheduleId: schedule.id,
          occurredAt: new Date(),
          metadata: settlement as unknown as Record<string, unknown>,
        },
        tx,
      );

      // 2. If escrow is tied to an Adoption, update Adoption and Pet
      if (escrow.adoption) {
        const adoption = escrow.adoption;

        // Enforce state machine: ensure adoption is in ESCROW_FUNDED before completing
        this.adoptionStateMachine.assertValidTransition(
          adoption.status,
          AdoptionStatus.COMPLETED,
        );

        await this.petAvailabilityService.transition(
          adoption.petId,
          PetStatus.ADOPTED,
          tx,
        );

        await tx.adoption.update({
          where: { id: adoption.id },
          data: { status: AdoptionStatus.COMPLETED },
        });

        await tx.pet.update({
          where: { id: adoption.petId },
          data: {
            currentOwnerId: adoption.adopterId,
          },
        });

        await this.events.logEvent({
          entityType: EventEntityType.ADOPTION,
          entityId: adoption.id,
          eventType: EventType.ADOPTION_COMPLETED,
          payload: { escrowId, petId: adoption.petId },
        });
      }

      return updatedEscrow;
    });
  }

  async refundEscrow(escrowId: string, txHash?: string) {
    return this.prisma.$transaction(async (tx) => {
      const escrow = await tx.escrow.findUnique({
        where: { id: escrowId },
      });

      if (!escrow) {
        throw new NotFoundException('Escrow not found');
      }

      const updatedEscrow = await tx.escrow.update({
        where: { id: escrowId },
        data: {
          status: EscrowStatus.REFUNDED,
          refundTxHash: txHash,
        },
      });

      await this.events.logEvent({
        entityType: EventEntityType.ESCROW,
        entityId: escrowId,
        eventType: EventType.ESCROW_REFUNDED,
        txHash,
        payload: { amount: Number(escrow.amount) },
      });

      await this.ledger.recordRefund(
        {
          amount: Number(escrow.amount),
          currency: escrow.assetCode,
          escrowId,
          feeScheduleId: escrow.feeScheduleId ?? undefined,
          occurredAt: new Date(),
          metadata: { refundTxHash: txHash },
        },
        tx,
      );

      return updatedEscrow;
    });
  }
}
