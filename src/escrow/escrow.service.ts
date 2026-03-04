import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  EscrowStatus,
  AdoptionStatus,
  EventEntityType,
  EventType,
} from '@prisma/client';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

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

  async releaseEscrow(escrowId: string, tx?: any, txHash?: string) {
    const prismaClient = tx || this.prisma;

    // Fetch escrow to check if it's tied to adoption or custody
    const escrow = await prismaClient.escrow.findUnique({
      where: { id: escrowId },
      include: { adoption: true, custody: true },
    });

    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }

    // In a real implementation, this would:
    // 1. Create Stellar transaction to release funds
    // 2. Submit transaction to Stellar network
    // 3. Wait for confirmation
    const releaseTxHash =
      txHash ||
      `RELEASE_TX_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const updatedEscrow = await prismaClient.escrow.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.RELEASED,
        releaseTxHash,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Escrow ${escrowId} released with tx: ${releaseTxHash}`);

    // Log event if not in transaction (custody calls handle their own events)
    if (!tx) {
      await this.events.logEvent({
        entityType: EventEntityType.ESCROW,
        entityId: escrowId,
        eventType: EventType.ESCROW_RELEASED,
        txHash: releaseTxHash,
        payload: { amount: Number(escrow.amount) },
      });

      // If escrow is tied to an Adoption, update Adoption and Pet
      if (escrow.adoption) {
        const adoption = escrow.adoption;

        await prismaClient.adoption.update({
          where: { id: adoption.id },
          data: { status: AdoptionStatus.COMPLETED },
        });

        await prismaClient.pet.update({
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
    }

    return updatedEscrow;
  }

  async refundEscrow(escrowId: string, tx?: any) {
    const prismaClient = tx || this.prisma;

    // In a real implementation, this would:
    // 1. Create Stellar transaction to refund to original depositor
    // 2. Submit transaction to Stellar network
    // 3. Wait for confirmation
    const refundTxHash = `REFUND_TX_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const escrow = await prismaClient.escrow.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.REFUNDED,
        refundTxHash,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Escrow ${escrowId} refunded with tx: ${refundTxHash}`);
    return escrow;
  }
}
