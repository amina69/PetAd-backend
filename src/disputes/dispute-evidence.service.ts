import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  DisputeStatus,
  EventEntityType,
  EventType,
} from '@prisma/client';

export const MAX_EVIDENCE_FILES = 10;

export interface AttachEvidenceInput {
  disputeId: string;
  documentIds: string[];
  actorId: string;
}

@Injectable()
export class DisputeEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async attachEvidence(input: AttachEvidenceInput): Promise<void> {
    const { disputeId, documentIds, actorId } = input;

    if (!documentIds.length) {
      throw new BadRequestException('At least one document ID is required');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        evidence: { select: { id: true } },
        adoption: { select: { id: true, adopterId: true, ownerId: true } },
        custody: { select: { id: true, holderId: true } },
      },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Only parties to the dispute may attach evidence
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

    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new ConflictException('Cannot add evidence to a resolved dispute');
    }

    const existing = dispute.evidence.length;
    if (existing + documentIds.length > MAX_EVIDENCE_FILES) {
      throw new BadRequestException(
        `Evidence limit is ${MAX_EVIDENCE_FILES} files. Already have ${existing}.`,
      );
    }

    // Validate each document: must exist and have been uploaded by the actor
    const documents = await this.prisma.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, uploadedById: true, fileUrl: true, publicId: true },
    });

    const foundIds = new Set(documents.map((d) => d.id));
    for (const id of documentIds) {
      if (!foundIds.has(id)) {
        throw new NotFoundException(`Document ${id} not found`);
      }
    }

    for (const doc of documents) {
      if (doc.uploadedById !== actorId) {
        throw new ForbiddenException(`Document ${doc.id} was not uploaded by you`);
      }
    }

    // Persist evidence rows, then emit one event per file with the file hash
    await this.prisma.$transaction(async (tx) => {
      await tx.disputeEvidence.createMany({
        data: documents.map((doc) => ({
          fileUrl: doc.fileUrl,
          fileName: doc.publicId,
          disputeId,
        })),
        skipDuplicates: true,
      });
    });

    for (const doc of documents) {
      const fileHash = computeFileHash(doc.fileUrl, doc.publicId);
      await this.events.logEvent({
        entityType: EventEntityType.DISPUTE,
        entityId: disputeId,
        eventType: EventType.DISPUTE_EVIDENCE_ADDED,
        actorId,
        payload: { documentId: doc.id, fileHash },
      });
    }
  }

  async findByDispute(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { id: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    return this.prisma.disputeEvidence.findMany({
      where: { disputeId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

/**
 * Deterministic proxy hash for a document: sha256(publicId + ':' + fileUrl).
 * Full on-chain verification happens at the settlement layer.
 */
function computeFileHash(fileUrl: string, publicId: string): string {
  return createHash('sha256').update(`${publicId}:${fileUrl}`).digest('hex');
}
