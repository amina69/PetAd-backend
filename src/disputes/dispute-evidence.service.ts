import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { DisputeStatus, EventEntityType, EventType } from '@prisma/client';
import { Role } from '../auth/enums/role.enum';

export const MAX_EVIDENCE_FILES = 10;

@Injectable()
export class DisputeEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async addEvidence(
    disputeId: string,
    fileUrl: string,
    fileName: string,
    actorId: string,
    actorRole: string,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        evidence: { select: { id: true } },
        adoption: { select: { adopterId: true, ownerId: true } },
        custody: { select: { holderId: true } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    if (
      dispute.status === DisputeStatus.RESOLVED ||
      dispute.status === DisputeStatus.WITHDRAWN
    ) {
      throw new ConflictException('Cannot add evidence to a closed dispute');
    }

    if (actorRole !== Role.ADMIN) {
      const partyIds = new Set<string>([dispute.filedById]);
      if (dispute.adoption) {
        partyIds.add(dispute.adoption.adopterId);
        partyIds.add(dispute.adoption.ownerId);
      }
      if (dispute.custody) {
        partyIds.add(dispute.custody.holderId);
      }
      if (!partyIds.has(actorId)) {
        throw new ForbiddenException('Not a party to this dispute');
      }
    }

    if (dispute.evidence.length >= MAX_EVIDENCE_FILES) {
      throw new BadRequestException(
        `Evidence limit of ${MAX_EVIDENCE_FILES} files reached`,
      );
    }

    const evidence = await this.prisma.disputeEvidence.create({
      data: { disputeId, fileUrl, fileName },
    });

    await this.events.logEvent({
      entityType: EventEntityType.DISPUTE,
      entityId: disputeId,
      eventType: EventType.DISPUTE_EVIDENCE_ADDED,
      actorId,
      payload: { evidenceId: evidence.id, fileName },
    });

    return evidence;
  }
}
