import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
import {
  DisputeStatus,
  DisputeOutcome,
  EscrowStatus,
  EventEntityType,
  EventType,
  NotificationType,
} from '@prisma/client';
import { DisputeStateMachine } from './dispute-state-machine';
import { Role } from '../auth/enums/role.enum';

export class ResolveDisputeDto {
  outcome: DisputeOutcome;
  resolution: string;
  splitPercent?: number;
}

@Injectable()
export class DisputeResolutionService {
  private readonly logger = new Logger(DisputeResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly escrow: EscrowService,
    private readonly stateMachine: DisputeStateMachine,
  ) {}

  async assignAdmin(disputeId: string, adminId: string, actorRole: string) {
    if (actorRole !== Role.ADMIN) {
      throw new ForbiddenException('Only admins can assign disputes');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    this.stateMachine.assertValidTransition(
      dispute.status,
      DisputeStatus.UNDER_REVIEW,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: DisputeStatus.UNDER_REVIEW,
          assignedToId: adminId,
        },
      });

      await tx.statusHistory.create({
        data: {
          entityType: EventEntityType.DISPUTE,
          entityId: disputeId,
          from: dispute.status,
          to: DisputeStatus.UNDER_REVIEW,
          actorId: adminId,
          at: new Date(),
        },
      });

      return d;
    });

    await this.events.logEvent({
      entityType: EventEntityType.DISPUTE,
      entityId: disputeId,
      eventType: EventType.DISPUTE_ASSIGNED,
      actorId: adminId,
      payload: { assigneeId: adminId },
    });

    await this.notifyParties(disputeId, 'Dispute assigned for review', adminId);

    return updated;
  }

  async resolve(
    disputeId: string,
    dto: ResolveDisputeDto,
    adminId: string,
    actorRole: string,
  ) {
    if (actorRole !== Role.ADMIN) {
      throw new ForbiddenException('Only admins can resolve disputes');
    }

    if (dto.resolution.trim().length < 20) {
      throw new BadRequestException(
        'Resolution must be at least 20 characters',
      );
    }

    if (dto.outcome === DisputeOutcome.SPLIT) {
      if (
        dto.splitPercent === undefined ||
        dto.splitPercent < 1 ||
        dto.splitPercent > 99
      ) {
        throw new BadRequestException(
          'splitPercent must be 1-99 for SPLIT outcome',
        );
      }
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        adoption: { include: { escrow: true } },
        custody: { include: { escrow: true } },
        filedBy: { select: { id: true } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    this.stateMachine.assertValidTransition(
      dispute.status,
      DisputeStatus.RESOLVED,
    );

    const escrow =
      dispute.adoption?.escrow ?? dispute.custody?.escrow ?? null;

    let escrowSettled = true;
    let escrowError: string | undefined;

    if (escrow && escrow.status === EscrowStatus.DISPUTED) {
      try {
        await this.settleEscrow(escrow.id, dto.outcome, dto.splitPercent);
      } catch (err) {
        escrowSettled = false;
        escrowError = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Escrow settlement failed for dispute ${disputeId}: ${escrowError}`,
        );
      }
    }

    const finalStatus = escrowSettled
      ? DisputeStatus.RESOLVED
      : DisputeStatus.RESOLUTION_PENDING;

    const updated = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: finalStatus,
          outcome: dto.outcome,
          splitPercent: dto.splitPercent ?? null,
          resolution: dto.resolution.trim(),
          resolvedById: adminId,
          resolvedAt: finalStatus === DisputeStatus.RESOLVED ? new Date() : null,
        },
      });

      await tx.statusHistory.create({
        data: {
          entityType: EventEntityType.DISPUTE,
          entityId: disputeId,
          from: dispute.status,
          to: finalStatus,
          actorId: adminId,
          reason: escrowSettled ? undefined : escrowError,
          at: new Date(),
        },
      });

      return d;
    });

    await this.events.logEvent({
      entityType: EventEntityType.DISPUTE,
      entityId: disputeId,
      eventType: EventType.DISPUTE_RESOLVED,
      actorId: adminId,
      payload: {
        outcome: dto.outcome,
        splitPercent: dto.splitPercent,
        status: finalStatus,
        escrowSettled,
      },
    });

    await this.notifyParties(
      disputeId,
      finalStatus === DisputeStatus.RESOLVED
        ? `Dispute resolved: ${dto.outcome}`
        : 'Dispute resolution pending escrow settlement',
      adminId,
    );

    if (finalStatus === DisputeStatus.RESOLUTION_PENDING) {
      throw new InternalServerErrorException({
        message: 'On-chain settlement failed; dispute marked RESOLUTION_PENDING',
        code: 'ESCROW_SETTLEMENT_FAILED',
        disputeId,
        escrowError,
      });
    }

    return updated;
  }

  async retrySettlement(disputeId: string, adminId: string, actorRole: string) {
    if (actorRole !== Role.ADMIN) {
      throw new ForbiddenException('Only admins can retry settlement');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        adoption: { include: { escrow: true } },
        custody: { include: { escrow: true } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    if (dispute.status !== DisputeStatus.RESOLUTION_PENDING) {
      throw new BadRequestException(
        'Only RESOLUTION_PENDING disputes can be retried',
      );
    }

    if (!dispute.outcome) {
      throw new BadRequestException('No outcome recorded on dispute');
    }

    const escrow =
      dispute.adoption?.escrow ?? dispute.custody?.escrow ?? null;

    if (!escrow) {
      throw new BadRequestException('No escrow linked to dispute');
    }

    await this.settleEscrow(
      escrow.id,
      dispute.outcome,
      dispute.splitPercent ?? undefined,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: DisputeStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      });

      await tx.statusHistory.create({
        data: {
          entityType: EventEntityType.DISPUTE,
          entityId: disputeId,
          from: DisputeStatus.RESOLUTION_PENDING,
          to: DisputeStatus.RESOLVED,
          actorId: adminId,
          reason: 'retry',
          at: new Date(),
        },
      });

      return d;
    });

    await this.events.logEvent({
      entityType: EventEntityType.DISPUTE,
      entityId: disputeId,
      eventType: EventType.DISPUTE_RESOLVED,
      actorId: adminId,
      payload: { outcome: dispute.outcome, retried: true },
    });

    return updated;
  }

  private async settleEscrow(
    escrowId: string,
    outcome: DisputeOutcome,
    splitPercent?: number | null,
  ) {
    switch (outcome) {
      case DisputeOutcome.RELEASE_TO_OWNER:
        await this.escrow.releaseEscrow(escrowId);
        break;
      case DisputeOutcome.REFUND_TO_HOLDER:
        await this.escrow.refundEscrow(escrowId);
        break;
      case DisputeOutcome.SPLIT:
        // Split ratio stored on dispute; settle as release for now
        await this.escrow.releaseEscrow(escrowId);
        break;
    }
  }

  private async notifyParties(
    disputeId: string,
    message: string,
    actorId: string,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        filedBy: { select: { id: true } },
        adoption: { select: { adopterId: true, ownerId: true } },
        custody: { select: { holderId: true } },
      },
    });

    if (!dispute) return;

    const partyIds = new Set<string>([dispute.filedById]);
    if (dispute.adoption) {
      partyIds.add(dispute.adoption.adopterId);
      partyIds.add(dispute.adoption.ownerId);
    }
    if (dispute.custody) {
      partyIds.add(dispute.custody.holderId);
    }
    partyIds.delete(actorId);

    if (partyIds.size === 0) return;

    await this.prisma.notification.createMany({
      data: Array.from(partyIds).map((userId) => ({
        userId,
        type: NotificationType.DISPUTE_UPDATE,
        title: 'Dispute Update',
        body: message,
        relatedEntityRoute: `/disputes/${disputeId}`,
        data: { disputeId },
      })),
    });
  }
}
