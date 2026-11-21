import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AbuseFlagStatus,
  AbuseSignalType,
  Prisma,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { AntiAbuseDetector } from './anti-abuse.detector';
import {
  AbuseThresholds,
  ProposedAbuseSignal,
  ReviewRecord,
  SharedSignalRecord,
} from './anti-abuse.types';

const REVIEW_LOOKBACK_DAYS = 90;
const DAY_MS = 86_400_000;

@Injectable()
export class AntiAbuseService {
  private readonly logger = new Logger(AntiAbuseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly logging: LoggingService,
    private readonly detector: AntiAbuseDetector,
    private readonly configService: ConfigService,
  ) {}

  /** Analyse a newly created review and queue any signals for moderators. */
  async evaluateReview(reviewId: string): Promise<ProposedAbuseSignal[]> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException(`Review ${reviewId} not found`);
    }

    const since = new Date(Date.now() - REVIEW_LOOKBACK_DAYS * DAY_MS);
    const recent = await this.prisma.review.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const participantIds = new Set<string>();
    for (const candidate of recent as ReviewRecord[]) {
      participantIds.add(candidate.reviewerId);
      participantIds.add(candidate.revieweeId);
    }

    const [adoptions, custodies, users] = await Promise.all([
      this.prisma.adoption.findMany({
        where: {
          OR: [
            {
              adopterId: review.reviewerId,
              ownerId: review.revieweeId,
            },
            {
              adopterId: review.revieweeId,
              ownerId: review.reviewerId,
            },
          ],
        },
        select: { id: true },
      }),
      this.prisma.custody.findMany({
        where: {
          holderId: { in: [review.reviewerId, review.revieweeId] },
        },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...participantIds] } },
        select: { id: true, createdAt: true },
      }),
    ]);

    const agreements = [
      ...adoptions.map((entry) => ({
        id: entry.id,
        participantIds: [review.reviewerId, review.revieweeId] as [string, string],
        createdAt: review.createdAt,
      })),
      ...custodies.map((entry) => ({
        id: entry.id,
        participantIds: [review.reviewerId, review.revieweeId] as [string, string],
        createdAt: review.createdAt,
      })),
    ];

    const signals = this.detector.analyze(
      {
        reviews: recent as ReviewRecord[],
        agreements,
        users,
        sharedSignals: this.collectSharedSignals(recent as ReviewRecord[]),
      },
      this.thresholds(),
    );

    const deduplicated = await this.persistSignals(signals);
    return deduplicated;
  }

  async getSignals(status?: AbuseFlagStatus) {
    return this.prisma.abuseSignal.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** Moderator view: flagged reviews stay visible together with their reasons. */
  async getFlaggedReviews(status?: AbuseFlagStatus) {
    const signals = await this.getSignals(status ?? AbuseFlagStatus.PENDING);
    const reviewIds = [...new Set(signals.map((signal) => signal.reviewId).filter(Boolean))] as string[];
    const reviews = reviewIds.length
      ? await this.prisma.review.findMany({
          where: { id: { in: reviewIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    return signals.map((signal) => ({
      signal,
      review: reviews.find((review) => review.id === signal.reviewId) ?? null,
      reason: signal.reason,
    }));
  }

  async resolveSignal(
    id: string,
    resolution: AbuseFlagStatus,
    adminId: string,
    note?: string,
  ) {
    const signal = await this.prisma.abuseSignal.findUnique({
      where: { id },
    });
    if (!signal) {
      throw new NotFoundException(`Abuse signal ${id} not found`);
    }

    const updated = await this.prisma.abuseSignal.update({
      where: { id },
      data: {
        status: resolution,
        resolutionNote: note,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    if (signal.reviewId) {
      if (resolution === AbuseFlagStatus.CONFIRMED) {
        await this.prisma.review.update({
          where: { id: signal.reviewId },
          data: { status: ReviewStatus.HIDDEN, weight: 0 },
        });
      } else if (resolution === AbuseFlagStatus.DISMISSED) {
        const remaining = await this.prisma.abuseSignal.count({
          where: {
            reviewId: signal.reviewId,
            status: AbuseFlagStatus.PENDING,
            id: { not: id },
          },
        });
        if (remaining === 0) {
          await this.prisma.review.update({
            where: { id: signal.reviewId },
            data: { status: ReviewStatus.VISIBLE, weight: 1 },
          });
        }
      }
    }

    await this.logging.log({
      level: 'INFO',
      action: 'TRUST_ABUSE_SIGNAL_RESOLVED',
      message: `Abuse signal ${id} resolved as ${resolution}`,
      userId: adminId,
      metadata: { signalId: id, resolution, reviewId: signal.reviewId },
    });

    return updated;
  }

  private async persistSignals(
    signals: ProposedAbuseSignal[],
  ): Promise<ProposedAbuseSignal[]> {
    if (signals.length === 0) return [];

    const reviewIds = [
      ...new Set(signals.map((signal) => signal.reviewId).filter(Boolean)),
    ] as string[];
    const existing = reviewIds.length
      ? await this.prisma.abuseSignal.findMany({
          where: { reviewId: { in: reviewIds } },
          select: { type: true, reviewId: true, reason: true },
        })
      : [];
    const known = new Set(
      existing.map((entry) => `${entry.type}|${entry.reviewId}|${entry.reason}`),
    );

    const fresh = signals.filter(
      (signal) => !known.has(`${signal.type}|${signal.reviewId}|${signal.reason}`),
    );
    if (fresh.length === 0) return [];

    await this.prisma.abuseSignal.createMany({
      data: fresh.map((signal) => ({
        type: signal.type as AbuseSignalType,
        reviewId: signal.reviewId,
        subjectUserId: signal.subjectUserId,
        actorUserId: signal.actorUserId,
        counterpartyUserId: signal.counterpartyUserId,
        hashedValue: signal.hashedValue,
        reason: signal.reason,
        severity: signal.severity,
        metadata: (signal.metadata ?? {}) as Prisma.InputJsonValue,
        status: AbuseFlagStatus.PENDING,
      })),
    });

    if (reviewIds.length) {
      await this.prisma.review.updateMany({
        where: { id: { in: reviewIds } },
        data: {
          status: ReviewStatus.FLAGGED,
          weight: this.thresholds().flaggedWeight,
        },
      });
    }

    await this.logging.log({
      level: 'WARN',
      action: 'TRUST_ABUSE_FLAGGED',
      message: `Queued ${fresh.length} trust abuse signals for moderator review`,
      metadata: {
        signalCount: fresh.length,
        types: [...new Set(fresh.map((signal) => signal.type))],
      },
    });
    this.logger.warn(`Flagged ${fresh.length} trust abuse signals`);

    return fresh;
  }

  private collectSharedSignals(reviews: ReviewRecord[]): SharedSignalRecord[] {
    const result: SharedSignalRecord[] = [];
    for (const [type, field] of [
      [AbuseSignalType.SHARED_DEVICE, 'deviceHash'],
      [AbuseSignalType.SHARED_IP, 'ipHash'],
    ] as const) {
      const groups = new Map<string, { users: Set<string>; reviewId?: string }>();
      for (const review of reviews) {
        const value = review[field];
        if (!value) continue;
        const entry = groups.get(value) ?? { users: new Set<string>() };
        entry.users.add(review.reviewerId);
        entry.reviewId = entry.reviewId ?? review.id;
        groups.set(value, entry);
      }
      for (const [hashedValue, entry] of groups) {
        result.push({
          type,
          hashedValue,
          userIds: [...entry.users],
          reviewId: entry.reviewId,
        });
      }
    }
    return result;
  }

  private thresholds(): AbuseThresholds & { flaggedWeight: number } {
    const get = <T>(key: string, fallback: T): T =>
      this.configService.get<T>(`trustAbuse.${key}`) ?? fallback;
    return {
      minAccountAgeDays: get('minAccountAgeDays', 30),
      reviewBurstWindowDays: get('reviewBurstWindowDays', 7),
      reviewBurstThreshold: get('reviewBurstThreshold', 5),
      agreementThreshold: get('agreementThreshold', 3),
      flaggedWeight: get('flaggedWeight', 0.2),
    };
  }
}
