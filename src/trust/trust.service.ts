import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TrustEventKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

export const TRUST_ALGORITHM_VERSION = 'v1';
export const DEFAULT_TRUST_SCORE = 50;
export const MIN_TRUST_SCORE = 0;
export const MAX_TRUST_SCORE = 100;

export interface RecordTrustEventInput {
  userId: string;
  kind: TrustEventKind;
  weight: number;
  /** Required reference to the domain EventLog record that caused this trust event. */
  sourceEventId: string;
  at?: Date;
  algorithmVersion?: string;
}

export interface TrustScoreUpdateResult {
  id: string;
  trustScore: number;
  previousScore: number;
  algorithmVersion: string;
  trustEventId: string;
  historyEntryId: string;
}

/**
 * Single authorized writer for TrustEvent, TrustScoreHistory, TrustSummary,
 * and the cached User.trustScore projection (BE-141).
 */
@Injectable()
export class TrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  static clampScore(score: number): number {
    return Math.max(MIN_TRUST_SCORE, Math.min(MAX_TRUST_SCORE, score));
  }

  /**
   * Projects a computed/replayed score onto the cached `User.trustScore` column
   * inside an existing transaction so `TrustService` remains the single
   * authorized writer across the entire codebase.
   */
  static async projectScoreInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    score: number,
  ): Promise<{ id: string; trustScore: number }> {
    return tx.user.update({
      where: { id: userId },
      data: { trustScore: TrustService.clampScore(score) },
      select: { id: true, trustScore: true },
    });
  }

  /**
   * Appends a TrustEvent referencing a persisted domain EventLog record,
   * appends a TrustScoreHistory snapshot, upserts TrustSummary, and updates
   * the cached User.trustScore projection inside one transaction.
   */
  async recordTrustEvent(
    input: RecordTrustEventInput,
  ): Promise<TrustScoreUpdateResult> {
    const sourceEventId = input.sourceEventId?.trim();
    if (!sourceEventId) {
      throw new BadRequestException(
        'sourceEventId is required: every trust event must reference its causing domain event',
      );
    }

    if (!Number.isFinite(input.weight)) {
      throw new BadRequestException('weight must be a finite number');
    }

    const algorithmVersion = input.algorithmVersion ?? TRUST_ALGORITHM_VERSION;
    const occurredAt = input.at ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const [user, sourceEvent] = await Promise.all([
        tx.user.findUnique({
          where: { id: input.userId },
          select: { id: true, trustScore: true },
        }),
        tx.eventLog.findUnique({
          where: { id: sourceEventId },
          select: { id: true },
        }),
      ]);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (!sourceEvent) {
        throw new NotFoundException(
          `Domain event ${sourceEventId} not found for trust event`,
        );
      }

      const previousScore = user.trustScore;
      const newScore = TrustService.clampScore(previousScore + input.weight);

      const trustEvent = await tx.trustEvent.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          weight: input.weight,
          sourceEventId: sourceEvent.id,
          at: occurredAt,
        },
      });

      const historyEntry = await tx.trustScoreHistory.create({
        data: {
          userId: input.userId,
          score: newScore,
          algorithmVersion,
          computedAt: occurredAt,
        },
      });

      await tx.trustSummary.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          currentScore: newScore,
          algorithmVersion,
          eventCount: 1,
          positiveEvents: input.weight > 0 ? 1 : 0,
          negativeEvents: input.weight < 0 ? 1 : 0,
          lastEventAt: occurredAt,
          computedAt: occurredAt,
        },
        update: {
          currentScore: newScore,
          algorithmVersion,
          eventCount: { increment: 1 },
          ...(input.weight > 0 ? { positiveEvents: { increment: 1 } } : {}),
          ...(input.weight < 0 ? { negativeEvents: { increment: 1 } } : {}),
          lastEventAt: occurredAt,
          computedAt: occurredAt,
        },
      });

      // Authorized cached projection update on User.trustScore.
      const updatedUser = await tx.user.update({
        where: { id: input.userId },
        data: { trustScore: newScore },
        select: {
          id: true,
          trustScore: true,
        },
      });

      return {
        id: updatedUser.id,
        trustScore: updatedUser.trustScore,
        previousScore,
        algorithmVersion,
        trustEventId: trustEvent.id,
        historyEntryId: historyEntry.id,
      };
    });
  }

  /**
   * Adjusts a user's trust score by `delta`, recording a domain EventLog entry
   * when no explicit `sourceEventId` is supplied so the resulting TrustEvent
   * always links to a persisted domain event.
   */
  async adjustTrustScore(
    userId: string,
    delta: number,
    options?: { kind?: TrustEventKind; sourceEventId?: string },
  ): Promise<{ id: string; trustScore: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, trustScore: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const expectedScore = TrustService.clampScore(user.trustScore + delta);
    const kind =
      options?.kind ??
      (delta >= 0
        ? TrustEventKind.CUSTODY_RETURNED
        : TrustEventKind.CUSTODY_VIOLATION);

    let sourceEventId = options?.sourceEventId;
    if (!sourceEventId) {
      const domainEvent = await this.eventsService.logEvent({
        entityType: 'USER',
        entityId: userId,
        eventType: 'TRUST_SCORE_UPDATED',
        payload: {
          previousScore: user.trustScore,
          newScore: expectedScore,
          delta,
          kind,
        },
      });
      sourceEventId = domainEvent.id;
    }

    const result = await this.recordTrustEvent({
      userId,
      kind,
      weight: delta,
      sourceEventId,
    });

    return {
      id: result.id,
      trustScore: result.trustScore,
    };
  }

  async getTrustSummary(userId: string) {
    return this.prisma.trustSummary.findUnique({
      where: { userId },
    });
  }

  async getTrustHistory(userId: string) {
    return this.prisma.trustScoreHistory.findMany({
      where: { userId },
      orderBy: { computedAt: 'desc' },
    });
  }

  async getTrustEvents(userId: string) {
    return this.prisma.trustEvent.findMany({
      where: { userId },
      orderBy: { at: 'desc' },
    });
  }
}
