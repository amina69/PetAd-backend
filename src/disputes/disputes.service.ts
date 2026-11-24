import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { DisputeStatus, EscrowStatus, EventEntityType, EventType } from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { AddDisputeCommentDto } from './dto/add-dispute-comment.dto';
import { Role } from '../auth/enums/role.enum';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async create(dto: CreateDisputeDto, actorId: string) {
    const { adoptionId, custodyId, escrowId } = await this.resolveEntity(dto.entity, actorId);

    const existing = await this.prisma.dispute.findFirst({
      where: {
        filedById: actorId,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
        ...(adoptionId ? { adoptionId } : { custodyId }),
      },
    });
    if (existing) throw new ConflictException('DISPUTE_ALREADY_OPEN');

    const dispute = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          reason: dto.reason,
          description: dto.description.trim(),
          filedById: actorId,
          adoptionId: adoptionId ?? null,
          custodyId: custodyId ?? null,
          evidence: dto.attachmentIds?.length
            ? { create: dto.attachmentIds.map((id) => ({ fileUrl: id, fileName: id })) }
            : undefined,
        },
        include: { evidence: true },
      });

      if (escrowId) {
        await tx.escrow.update({
          where: { id: escrowId },
          data: { status: EscrowStatus.DISPUTED },
        });
      }

      return created;
    });

    await this.events.logEvent({
      entityType: EventEntityType.DISPUTE,
      entityId: dispute.id,
      eventType: EventType.DISPUTE_OPENED,
      actorId,
      payload: { reason: dto.reason, entity: dto.entity, adoptionId, custodyId },
    });

    return dispute;
  }

  async findOne(id: string, actorId: string, actorRole: string, page = 1, limit = 20) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        filedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        resolvedBy: { select: { id: true, email: true } },
        evidence: true,
        adoption: { select: { id: true, adopterId: true, ownerId: true } },
        custody: { select: { id: true, holderId: true } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');
    this.assertAccess(dispute, actorId, actorRole);

    const isAdmin = actorRole === Role.ADMIN;
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      this.prisma.disputeComment.findMany({
        where: { disputeId: id, ...(isAdmin ? {} : { internal: false }) },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        include: { author: { select: { id: true, email: true, firstName: true } } },
      }),
      this.prisma.disputeComment.count({
        where: { disputeId: id, ...(isAdmin ? {} : { internal: false }) },
      }),
    ]);

    return { ...dispute, comments, commentsMeta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async addComment(id: string, dto: AddDisputeCommentDto, actorId: string, actorRole: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        adoption: { select: { id: true, adopterId: true, ownerId: true } },
        custody: { select: { id: true, holderId: true } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new ConflictException('Cannot comment on a resolved dispute');
    }

    this.assertAccess(dispute, actorId, actorRole);

    const internal = actorRole === Role.ADMIN ? (dto.internal ?? false) : false;

    const comment = await this.prisma.disputeComment.create({
      data: { body: dto.body.trim(), internal, disputeId: id, authorId: actorId },
      include: { author: { select: { id: true, email: true, firstName: true } } },
    });

    await this.events.logEvent({
      entityType: EventEntityType.DISPUTE,
      entityId: id,
      eventType: EventType.DISPUTE_COMMENT_ADDED,
      actorId,
      payload: { commentId: comment.id, internal },
    });

    return comment;
  }

  private async resolveEntity(entityId: string, actorId: string) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: entityId },
      select: { id: true, adopterId: true, ownerId: true, escrowId: true },
    });
    if (adoption) {
      if (adoption.adopterId !== actorId && adoption.ownerId !== actorId) {
        throw new NotFoundException('Entity not found');
      }
      return {
        adoptionId: adoption.id,
        custodyId: undefined as string | undefined,
        escrowId: adoption.escrowId ?? undefined,
      };
    }

    const custody = await this.prisma.custody.findUnique({
      where: { id: entityId },
      select: { id: true, holderId: true, escrowId: true },
    });
    if (custody) {
      if (custody.holderId !== actorId) throw new NotFoundException('Entity not found');
      return {
        adoptionId: undefined as string | undefined,
        custodyId: custody.id,
        escrowId: custody.escrowId ?? undefined,
      };
    }

    throw new NotFoundException('Entity not found');
  }

  private assertAccess(
    dispute: {
      filedById: string;
      adoption: { adopterId: string; ownerId: string } | null;
      custody: { holderId: string } | null;
    },
    actorId: string,
    actorRole: string,
  ) {
    if (actorRole === Role.ADMIN) return;
    const partyIds = new Set<string>([dispute.filedById]);
    if (dispute.adoption) {
      partyIds.add(dispute.adoption.adopterId);
      partyIds.add(dispute.adoption.ownerId);
    }
    if (dispute.custody) partyIds.add(dispute.custody.holderId);
    if (!partyIds.has(actorId)) throw new ForbiddenException('Not a party to this dispute');
  }
}
