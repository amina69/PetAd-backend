import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import {
  AdoptionStatus,
  CustodyStatus,
  EscrowStatus,
  EventEntityType,
  EventType,
} from '@prisma/client';
import { PetStatus } from '../common/enums/pet-status.enum';

/** Hours after APPROVED before an unfunded escrow is cancelled. */
const FUNDING_DEADLINE_HOURS = 48;
/** Hours after FUNDED with no further action before admin is flagged. */
const MAX_HOLD_HOURS = 168; // 7 days
/** How often the job ticks (1 hour in ms). */
const TICK_MS = 60 * 60 * 1000;

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

@Injectable()
export class EscrowTimeoutJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscrowTimeoutJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly notifications: NotificationQueueService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.expireUnfundedEscrows();
      void this.flagStaleFundedEscrows();
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Cancel APPROVED adoptions/custodies whose escrow was never funded within
   * the funding deadline, and release the pet reservation.
   */
  async expireUnfundedEscrows(): Promise<void> {
    const deadline = hoursAgo(FUNDING_DEADLINE_HOURS);

    const staleAdoptions = await this.prisma.adoption.findMany({
      where: {
        status: AdoptionStatus.APPROVED,
        updatedAt: { lt: deadline },
        escrow: { status: EscrowStatus.CREATED },
      },
      include: {
        escrow: true,
        adopter: { select: { id: true, email: true } },
        owner: { select: { id: true, email: true } },
      },
    });

    for (const adoption of staleAdoptions) {
      // Skip escrows frozen by an open dispute; they will be settled by the
      // dispute resolution flow instead (issue #294).
      if (adoption.escrow?.status === EscrowStatus.DISPUTED) {
        this.logger.log(
          `Skipping adoption ${adoption.id}: escrow ${adoption.escrowId} is frozen by an open dispute`,
        );
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.adoption.update({
            where: { id: adoption.id },
            data: { status: AdoptionStatus.CANCELLED },
          });

          if (adoption.escrowId) {
            await tx.escrow.update({
              where: { id: adoption.escrowId },
              data: { status: EscrowStatus.REFUNDED },
            });
          }

          await tx.pet.update({
            where: { id: adoption.petId },
            data: { status: PetStatus.AVAILABLE },
          });

          await this.events.logEvent({
            entityType: EventEntityType.ADOPTION,
            entityId: adoption.id,
            eventType: EventType.ADOPTION_CANCELLED,
            payload: { reason: 'escrow_funding_timeout', escrowId: adoption.escrowId },
          });
        });

        if (adoption.adopter.email) {
          await this.notifications.enqueueSendTransactionalEmail({
            dto: {
              to: adoption.adopter.email,
              subject: 'Adoption request expired — escrow not funded in time',
              text: `Your adoption request (ID: ${adoption.id}) was cancelled because the escrow was not funded within ${FUNDING_DEADLINE_HOURS} hours. The pet is now available again.`,
            },
          });
        }

        this.logger.log(`Expired unfunded adoption ${adoption.id}`);
      } catch (err) {
        this.logger.error(`Failed to expire adoption ${adoption.id}`, err);
      }
    }

    const staleCustodies = await this.prisma.custody.findMany({
      where: {
        status: CustodyStatus.PENDING,
        updatedAt: { lt: deadline },
        escrow: { status: EscrowStatus.CREATED },
      },
      include: {
        escrow: true,
        holder: { select: { id: true, email: true } },
      },
    });

    for (const custody of staleCustodies) {
      // Skip escrows frozen by an open dispute (issue #294).
      if (custody.escrow?.status === EscrowStatus.DISPUTED) {
        this.logger.log(
          `Skipping custody ${custody.id}: escrow ${custody.escrowId} is frozen by an open dispute`,
        );
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.custody.update({
            where: { id: custody.id },
            data: { status: CustodyStatus.CANCELLED },
          });

          if (custody.escrowId) {
            await tx.escrow.update({
              where: { id: custody.escrowId },
              data: { status: EscrowStatus.REFUNDED },
            });
          }

          await tx.pet.update({
            where: { id: custody.petId },
            data: { status: PetStatus.AVAILABLE },
          });

          await this.events.logEvent({
            entityType: EventEntityType.CUSTODY,
            entityId: custody.id,
            eventType: EventType.CUSTODY_CANCELLED,
            payload: { reason: 'escrow_funding_timeout', escrowId: custody.escrowId },
          });
        });

        if (custody.holder.email) {
          await this.notifications.enqueueSendTransactionalEmail({
            dto: {
              to: custody.holder.email,
              subject: 'Custody arrangement expired — escrow not funded in time',
              text: `Your custody arrangement (ID: ${custody.id}) was cancelled because the escrow was not funded within ${FUNDING_DEADLINE_HOURS} hours. The pet is now available again.`,
            },
          });
        }

        this.logger.log(`Expired unfunded custody ${custody.id}`);
      } catch (err) {
        this.logger.error(`Failed to expire custody ${custody.id}`, err);
      }
    }
  }

  /**
   * Flag FUNDED escrows that have exceeded the maximum hold period without
   * progressing. Notifies all parties once at this threshold crossing.
   */
  async flagStaleFundedEscrows(): Promise<void> {
    const holdDeadline = hoursAgo(MAX_HOLD_HOURS);

    const staleEscrows = await this.prisma.escrow.findMany({
      where: {
        status: EscrowStatus.FUNDED,
        updatedAt: { lt: holdDeadline },
      },
      include: {
        adoption: {
          include: {
            adopter: { select: { id: true, email: true } },
            owner: { select: { id: true, email: true } },
          },
        },
        custody: {
          include: {
            holder: { select: { id: true, email: true } },
          },
        },
      },
    });

    for (const escrow of staleEscrows) {
      try {
        await this.events.logEvent({
          entityType: EventEntityType.ESCROW,
          entityId: escrow.id,
          eventType: EventType.ESCROW_FUNDED,
          payload: {
            flagged: true,
            reason: 'max_hold_exceeded',
            heldSince: escrow.updatedAt,
          },
        });

        const emails: string[] = [];
        if (escrow.adoption) {
          if (escrow.adoption.adopter.email) emails.push(escrow.adoption.adopter.email);
          if (escrow.adoption.owner.email) emails.push(escrow.adoption.owner.email);
        }
        if (escrow.custody?.holder.email) {
          emails.push(escrow.custody.holder.email);
        }

        for (const email of emails) {
          await this.notifications.enqueueSendTransactionalEmail({
            dto: {
              to: email,
              subject: 'Action required — escrow held beyond the allowed period',
              text: `Escrow ${escrow.id} has been in FUNDED state for over ${MAX_HOLD_HOURS} hours. Please contact support or complete the transaction.`,
            },
          });
        }

        this.logger.warn(`Flagged stale funded escrow ${escrow.id} for admin review`);
      } catch (err) {
        this.logger.error(`Failed to flag escrow ${escrow.id}`, err);
      }
    }
  }
}
