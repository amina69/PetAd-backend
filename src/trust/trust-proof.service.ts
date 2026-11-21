import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrustAnchorService } from './trust-anchor.service';
import { VerifyProofDto } from './dto/trust.dto';
import { canonicalJson, hashEvent, sha256 } from './trust-proof.crypto';

const PROOF_VERSION = 'trust-proof-v1';

interface TrustSnapshotForProof {
  userId: string;
  score: number;
  algorithmVersion: string;
  anchoredThrough?: string | null;
}

interface TrustEventReference {
  sourceEventId: string;
}

interface StoredEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string | null;
  createdAt: Date;
  payload: Prisma.JsonValue;
}

export interface TrustProofBundle {
  version: string;
  userId: string;
  algorithmVersion: string;
  score: number;
  eventIds: string[];
  proofs: Array<{
    eventId: string;
    hash: string;
    anchorBatchId: string | null;
  }>;
  rootHash: string;
  anchoredThrough: string | null;
}

export interface TrustProofVerification {
  valid: boolean;
  reason?: string;
  anchoredAt: null;
  txHash: null;
  explorerUrl: null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rootHashOf(input: {
  userId: string;
  algorithmVersion: string;
  score: number;
  entries: Array<{ eventId: string; hash: string }>;
}): string {
  const entries = [...input.entries].sort((left, right) =>
    left.eventId.localeCompare(right.eventId),
  );
  return sha256(
    canonicalJson({
      version: PROOF_VERSION,
      userId: input.userId,
      algorithmVersion: input.algorithmVersion,
      score: round2(input.score),
      entries: entries.map((entry) => ({
        eventId: entry.eventId,
        hash: entry.hash.toLowerCase(),
      })),
    }),
  );
}

@Injectable()
export class TrustProofService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anchors: TrustAnchorService,
  ) {}

  async buildBundle(
    snapshot: TrustSnapshotForProof,
    trustEvents: readonly TrustEventReference[],
  ): Promise<TrustProofBundle> {
    const eventIds = Array.from(
      new Set(trustEvents.map((event) => event.sourceEventId)),
    ).sort((left, right) => left.localeCompare(right));
    const storedEvents = await this.findEvents(eventIds);
    const storedById = new Map(storedEvents.map((event) => [event.id, event]));
    const anchorBatches =
      await this.anchors.latestAnchorBatchForEvents(eventIds);

    const proofs = eventIds.map((eventId) => {
      const event = storedById.get(eventId);
      return {
        eventId,
        hash: event ? hashEvent(event) : '',
        anchorBatchId: anchorBatches.get(eventId) ?? null,
      };
    });

    return {
      version: PROOF_VERSION,
      userId: snapshot.userId,
      algorithmVersion: snapshot.algorithmVersion,
      score: round2(snapshot.score),
      eventIds,
      proofs,
      rootHash: rootHashOf({
        userId: snapshot.userId,
        algorithmVersion: snapshot.algorithmVersion,
        score: snapshot.score,
        entries: proofs,
      }),
      anchoredThrough:
        snapshot.anchoredThrough ??
        (await this.anchors.latestAnchorBatch(eventIds)),
    };
  }

  async verify(dto: VerifyProofDto): Promise<TrustProofVerification> {
    const invalid = (reason: string): TrustProofVerification => ({
      valid: false,
      reason,
      anchoredAt: null,
      txHash: null,
      explorerUrl: null,
    });

    if (dto.version !== PROOF_VERSION)
      return invalid('UNSUPPORTED_PROOF_VERSION');

    const expectedRoot = rootHashOf({
      userId: dto.userId,
      algorithmVersion: dto.algorithmVersion,
      score: dto.score,
      entries: dto.proofs,
    });
    if (expectedRoot !== dto.rootHash.toLowerCase()) {
      return invalid('ROOT_HASH_MISMATCH');
    }

    const proofIds = dto.proofs.map((proof) => proof.eventId).sort();
    const declaredIds = [...dto.eventIds].sort();
    if (
      proofIds.length !== declaredIds.length ||
      proofIds.some((id, index) => id !== declaredIds[index])
    ) {
      return invalid('EVENT_ID_MISMATCH');
    }

    const storedEvents = await this.findEvents(declaredIds);
    if (storedEvents.length !== declaredIds.length) {
      return invalid('UNKNOWN_EVENT');
    }

    const storedById = new Map(storedEvents.map((event) => [event.id, event]));
    for (const proof of dto.proofs) {
      const event = storedById.get(proof.eventId);
      if (!event || hashEvent(event) !== proof.hash.toLowerCase()) {
        return invalid('EVENT_HASH_MISMATCH');
      }
    }

    const subjectReferences = await this.prisma.trustEvent.findMany({
      where: {
        subjectUserId: dto.userId,
        sourceEventId: { in: declaredIds },
      },
      select: { sourceEventId: true },
    });
    const referencedIds = new Set(
      subjectReferences.map(
        (event: TrustEventReference) => event.sourceEventId,
      ),
    );
    if (declaredIds.some((id) => !referencedIds.has(id))) {
      return invalid('SUBJECT_MISMATCH');
    }

    const anchorBatches =
      await this.anchors.latestAnchorBatchForEvents(declaredIds);
    const actualAnchor =
      Array.from(anchorBatches.values()).sort().pop() ?? null;
    if (actualAnchor !== (dto.anchoredThrough ?? null)) {
      return invalid('ANCHOR_MISMATCH');
    }

    return {
      valid: true,
      anchoredAt: null,
      txHash: null,
      explorerUrl: null,
    };
  }

  private async findEvents(
    eventIds: readonly string[],
  ): Promise<StoredEvent[]> {
    if (eventIds.length === 0) return [];
    return this.prisma.eventLog.findMany({
      where: { id: { in: [...eventIds] } },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        eventType: true,
        actorId: true,
        createdAt: true,
        payload: true,
      },
    }) as Promise<StoredEvent[]>;
  }
}
