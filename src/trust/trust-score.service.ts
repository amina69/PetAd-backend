import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TrustEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { TrustAnchorService } from './trust-anchor.service';
import { TrustScoringService } from './scoring/trust-scoring.service';
import { TrustScoreResult } from './scoring/trust-scoring.types';

export interface RecomputeOptions {
  asOf?: Date;
  dryRun?: boolean;
  force?: boolean;
  algorithmVersion?: string;
}

export interface RecomputeChange {
  userId: string;
  previousScore: number;
  nextScore: number;
  previousVersion: string | null;
  nextVersion: string;
}

export interface RecomputeSummary {
  scanned: number;
  updated: number;
  changes: RecomputeChange[];
}

interface TrustEventRow {
  id: string;
  type: TrustEventType;
  sourceEventId: string;
  occurredAt: Date;
  weight: number;
}

interface SnapshotRow {
  score: number;
  algorithmVersion: string;
}

@Injectable()
export class TrustScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: TrustScoringService,
    private readonly anchors: TrustAnchorService,
    private readonly events: EventsService,
  ) {}

  async recomputeUser(
    userId: string,
    options: RecomputeOptions = {},
  ): Promise<TrustScoreResult> {
    const asOf = options.asOf ?? new Date();
    const prepared = await this.prepare(userId, asOf);
    const previous = await this.prisma.trustScore.findUnique({
      where: { userId },
      select: { score: true, algorithmVersion: true },
    });

    if (!options.force && !this.hasDrift(previous, prepared.result)) {
      return prepared.result;
    }

    const snapshot = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { trustScore: true },
      });
      if (!user) return null;

      const current = await tx.trustScore.findUnique({
        where: { userId },
        select: { score: true, algorithmVersion: true },
      });
      if (!options.force && !this.hasDrift(current, prepared.result)) {
        return null;
      }

      const saved = await tx.trustScore.upsert({
        where: { userId },
        create: {
          userId,
          score: prepared.result.score,
          band: prepared.result.band,
          algorithmVersion: prepared.result.version,
          factors: prepared.result.factors as unknown as Prisma.InputJsonValue,
          eventCount: prepared.result.eventCount,
          completedAgreements: prepared.stats.completedAgreements,
          disputesTotal: prepared.stats.disputesTotal,
          disputesResolvedInFavour: prepared.stats.resolvedInFavour,
          anchoredThrough: prepared.anchoredThrough,
          calculatedAt: asOf,
        },
        update: {
          score: prepared.result.score,
          band: prepared.result.band,
          algorithmVersion: prepared.result.version,
          factors: prepared.result.factors as unknown as Prisma.InputJsonValue,
          eventCount: prepared.result.eventCount,
          completedAgreements: prepared.stats.completedAgreements,
          disputesTotal: prepared.stats.disputesTotal,
          disputesResolvedInFavour: prepared.stats.resolvedInFavour,
          anchoredThrough: prepared.anchoredThrough,
          calculatedAt: asOf,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { trustScore: prepared.result.score },
      });

      return {
        saved,
        previousScore: user.trustScore,
      };
    });

    if (snapshot && snapshot.previousScore !== prepared.result.score) {
      await this.events.logEvent({
        entityType: 'USER',
        entityId: userId,
        eventType: 'TRUST_SCORE_UPDATED',
        payload: {
          previousScore: snapshot.previousScore,
          newScore: prepared.result.score,
          algorithmVersion: prepared.result.version,
          source: 'trust-projection',
        },
      });
    }

    return prepared.result;
  }

  async recomputeAll(
    options: RecomputeOptions = {},
  ): Promise<RecomputeSummary> {
    if (
      options.algorithmVersion &&
      options.algorithmVersion !== this.scoring.version
    ) {
      throw new BadRequestException(
        `Algorithm version ${options.algorithmVersion} is not installed`,
      );
    }

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { trustEvents: { some: {} } },
          { trustScoreSnapshot: { isNot: null } },
        ],
      },
      select: { id: true },
    });

    const summary: RecomputeSummary = {
      scanned: users.length,
      updated: 0,
      changes: [],
    };

    for (const user of users) {
      const current = await this.prisma.trustScore.findUnique({
        where: { userId: user.id },
        select: { score: true, algorithmVersion: true },
      });

      if (options.dryRun) {
        const prepared = await this.prepare(
          user.id,
          options.asOf ?? new Date(),
        );
        if (this.hasDrift(current, prepared.result)) {
          summary.changes.push(
            this.toChange(user.id, current, prepared.result),
          );
        }
        continue;
      }

      const before = current;
      await this.recomputeUser(user.id, {
        ...options,
        force: options.force ?? true,
      });
      const after = await this.prisma.trustScore.findUnique({
        where: { userId: user.id },
        select: { score: true, algorithmVersion: true },
      });
      if (
        after &&
        this.hasDrift(before, {
          score: after.score,
          version: after.algorithmVersion,
        })
      ) {
        summary.updated += 1;
        summary.changes.push(
          this.toChange(user.id, before, {
            score: after.score,
            version: after.algorithmVersion,
          }),
        );
      }
    }

    return summary;
  }

  async getSnapshot(userId: string) {
    return this.prisma.trustScore.findUnique({ where: { userId } });
  }

  private async prepare(userId: string, asOf: Date) {
    const events = await this.prisma.trustEvent.findMany({
      where: { subjectUserId: userId },
      select: {
        id: true,
        type: true,
        sourceEventId: true,
        occurredAt: true,
        weight: true,
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

    const stats = await this.collectStats(userId, events as TrustEventRow[]);
    const sourceEventIds = Array.from(
      new Set(events.map((event) => event.sourceEventId)),
    );
    const anchoredThrough =
      await this.anchors.latestAnchorBatch(sourceEventIds);
    const result = this.scoring.calculate(events as TrustEventRow[], asOf);

    return { result, stats, anchoredThrough };
  }

  private async collectStats(userId: string, events: readonly TrustEventRow[]) {
    const [completedAdoptions, completedCustodies, openDisputes] =
      await Promise.all([
        this.prisma.adoption.count({
          where: {
            status: 'COMPLETED',
            OR: [{ adopterId: userId }, { ownerId: userId }],
          },
        }),
        this.prisma.custody.count({
          where: { status: 'COMPLETED', holderId: userId },
        }),
        this.prisma.escrow.count({
          where: {
            status: 'DISPUTED',
            OR: [
              {
                adoption: { OR: [{ adopterId: userId }, { ownerId: userId }] },
              },
              { custody: { holderId: userId } },
            ],
          },
        }),
      ]);

    const disputeSources = new Set(
      events
        .filter((event) => event.type.startsWith('DISPUTE_'))
        .map((event) => event.sourceEventId),
    );
    const resolvedInFavour = events.filter(
      (event) => event.type === 'DISPUTE_RESOLVED_IN_FAVOUR',
    ).length;

    return {
      completedAgreements: completedAdoptions + completedCustodies,
      disputesTotal: disputeSources.size + openDisputes,
      resolvedInFavour,
    };
  }

  private hasDrift(
    current: SnapshotRow | null,
    result: Pick<TrustScoreResult, 'score' | 'version'>,
  ): boolean {
    if (!current) return true;
    return (
      current.algorithmVersion !== result.version ||
      Math.abs(current.score - result.score) > 0.001
    );
  }

  private toChange(
    userId: string,
    before: SnapshotRow | null,
    after: Pick<TrustScoreResult, 'score' | 'version'>,
  ): RecomputeChange {
    return {
      userId,
      previousScore: before?.score ?? 50,
      nextScore: after.score,
      previousVersion: before?.algorithmVersion ?? null,
      nextVersion: after.version,
    };
  }
}
