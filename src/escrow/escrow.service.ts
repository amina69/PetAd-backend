import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowStatus, AdoptionStatus, EventEntityType, EventType } from '@prisma/client';

@Injectable()
export class EscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) { }

  async createEscrow(amount: number, tx?: any) {
    const prismaClient = tx || this.prisma;

    // Generate Stellar keypair placeholders
    // In a real implementation, this would use the Stellar SDK
    const stellarPublicKey = `ESCROW_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const stellarSecretEncrypted = `ENCRYPTED_SECRET_${Date.now()}`;

    return prismaClient.escrow.create({
      data: {
        stellarPublicKey,
        stellarSecretEncrypted,
        amount,
        status: 'CREATED',
      },
    });
  }

  async releaseEscrow(escrowId: string, txHash?: string) {
    return this.prisma.$transaction(async (tx) => {
      const escrow = await tx.escrow.findUnique({
        where: { id: escrowId },
        include: { adoption: true },
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

      // 2. If escrow is tied to an Adoption, update Adoption and Pet
      if (escrow.adoption) {
        const adoption = escrow.adoption;

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
}
