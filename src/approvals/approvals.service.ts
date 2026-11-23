import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  ApprovalStatus,
  DecisionType,
  EventEntityType,
  EventType,
} from '@prisma/client';
import {
  CreateApprovalRequestDto,
  DecideApprovalDto,
  ListApprovalsQueryDto,
} from './approvals.dto';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async createRequest(requesterId: string, dto: CreateApprovalRequestDto) {
    const existing = await this.prisma.approvalRequest.findFirst({
      where: {
        referenceId: dto.referenceId,
        type: dto.type,
        status: ApprovalStatus.PENDING,
      },
    });

    if (existing) {
      throw new ConflictException(
        `A pending approval request already exists for this ${dto.type} (id: ${dto.referenceId})`,
      );
    }

    const request = await this.prisma.approvalRequest.create({
      data: {
        type: dto.type,
        referenceId: dto.referenceId,
        requesterId,
        notes: dto.notes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        status: ApprovalStatus.PENDING,
      },
      include: { requester: { select: { id: true, email: true } } },
    });

    await this.events.logEvent({
      entityType: EventEntityType.APPROVAL,
      entityId: request.id,
      eventType: EventType.APPROVAL_REQUESTED,
      actorId: requesterId,
      payload: { type: dto.type, referenceId: dto.referenceId },
    });

    return request;
  }

  async decide(
    approvalId: string,
    deciderId: string,
    dto: DecideApprovalDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Row-level lock to prevent concurrent decisions
      const request = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM approval_requests WHERE id = ${approvalId} FOR UPDATE
      `;

      if (!request.length) {
        throw new NotFoundException(`Approval request ${approvalId} not found`);
      }

      const current = request[0];

      if (current.status !== ApprovalStatus.PENDING) {
        throw new ConflictException(
          `Approval request is already ${current.status} and cannot be decided`,
        );
      }

      const full = await tx.approvalRequest.findUniqueOrThrow({
        where: { id: approvalId },
      });

      if (full.requesterId === deciderId) {
        throw new ForbiddenException(
          'Requesters cannot decide their own approval requests',
        );
      }

      const newStatus =
        dto.decision === 'APPROVE'
          ? ApprovalStatus.APPROVED
          : ApprovalStatus.REJECTED;

      const [updated] = await Promise.all([
        tx.approvalRequest.update({
          where: { id: approvalId },
          data: { status: newStatus, reviewerId: deciderId },
          include: { requester: { select: { id: true, email: true } } },
        }),
        tx.approvalDecision.create({
          data: {
            approvalRequestId: approvalId,
            deciderId,
            decision: dto.decision as DecisionType,
            reason: dto.reason,
          },
        }),
      ]);

      await this.events.logEvent({
        entityType: EventEntityType.APPROVAL,
        entityId: approvalId,
        eventType:
          dto.decision === 'APPROVE'
            ? EventType.APPROVAL_APPROVED
            : EventType.APPROVAL_REJECTED,
        actorId: deciderId,
        payload: { decision: dto.decision, reason: dto.reason },
      });

      return updated;
    });
  }

  async list(query: ListApprovalsQueryDto) {
    return this.prisma.approvalRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      include: {
        requester: { select: { id: true, email: true } },
        reviewer: { select: { id: true, email: true } },
        decisions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, email: true } },
        reviewer: { select: { id: true, email: true } },
        decisions: { include: { decider: { select: { id: true, email: true } } } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Approval request ${id} not found`);
    }

    return request;
  }

  async expireStale(): Promise<number> {
    const now = new Date();

    const stale = await this.prisma.approvalRequest.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        expiresAt: { lte: now },
      },
      select: { id: true },
    });

    if (!stale.length) return 0;

    const ids = stale.map((r) => r.id);

    await this.prisma.approvalRequest.updateMany({
      where: { id: { in: ids } },
      data: { status: ApprovalStatus.EXPIRED },
    });

    for (const { id } of stale) {
      await this.events.logEvent({
        entityType: EventEntityType.APPROVAL,
        entityId: id,
        eventType: EventType.APPROVAL_EXPIRED,
        payload: { expiredAt: now.toISOString() },
      });
    }

    this.logger.log(`Expired ${ids.length} stale approval request(s)`);
    return ids.length;
  }
}
