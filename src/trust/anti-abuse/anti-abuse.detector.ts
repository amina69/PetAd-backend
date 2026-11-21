import { Injectable } from '@nestjs/common';
import { AbuseSignalType } from '@prisma/client';
import {
  AgreementRecord,
  AnalysisInput,
  ProposedAbuseSignal,
  ReviewRecord,
  SharedSignalRecord,
  UserRecord,
} from './anti-abuse.types';

const DAY_MS = 86_400_000;
const MAX_RING_LENGTH = 20;

type EdgeMap = Map<string, Map<string, ReviewRecord[]>>;

@Injectable()
export class AntiAbuseDetector {
  analyze(input: AnalysisInput, thresholds: {
    minAccountAgeDays: number;
    reviewBurstWindowDays: number;
    reviewBurstThreshold: number;
    agreementThreshold: number;
  }): ProposedAbuseSignal[] {
    return [
      ...this.detectReciprocalRings(input.reviews),
      ...this.detectRepeatedAgreements(input.agreements, thresholds.agreementThreshold),
      ...this.detectNewAccountBursts(
        input.reviews,
        input.users,
        thresholds,
        input.now ?? new Date(),
      ),
      ...this.detectSharedSignals(input.sharedSignals ?? []),
    ];
  }

  /**
   * Flag reciprocal pairs and longer cycles (e.g. a five-account ring
   * A -> B -> C -> D -> E -> A). Every review that forms part of a ring is
   * flagged so moderators see the whole pattern, not one isolated edge.
   */
  detectReciprocalRings(reviews: ReviewRecord[]): ProposedAbuseSignal[] {
    const edges: EdgeMap = new Map();
    for (const review of reviews) {
      const targets = edges.get(review.reviewerId) ?? new Map<string, ReviewRecord[]>();
      targets.set(review.revieweeId, [
        ...(targets.get(review.revieweeId) ?? []),
        review,
      ]);
      edges.set(review.reviewerId, targets);
    }

    const signals: ProposedAbuseSignal[] = [];
    const flaggedReviews = new Set<string>();

    const flagReview = (
      review: ReviewRecord,
      type: AbuseSignalType,
      reason: string,
      severity: number,
    ) => {
      if (flaggedReviews.has(`${type}:${review.id}`)) return;
      flaggedReviews.add(`${type}:${review.id}`);
      signals.push({
        type,
        reviewId: review.id,
        actorUserId: review.reviewerId,
        counterpartyUserId: review.revieweeId,
        reason,
        severity,
        metadata: { ring: type === AbuseSignalType.REVIEW_RING },
      });
    };

    for (const [from, targets] of edges) {
      for (const [to, forward] of targets) {
        if (from >= to) continue;
        const backward = edges.get(to)?.get(from) ?? [];
        if (backward.length === 0) continue;
        const reason = `Reciprocal reviews between ${from} and ${to}`;
        for (const review of [...forward, ...backward]) {
          flagReview(review, AbuseSignalType.RECIPROCAL_REVIEW, reason, 2);
        }
      }
    }

    const reportedCycles = new Set<string>();
    for (const start of edges.keys()) {
      const path: string[] = [];
      const visited = new Set<string>();

      const walk = (node: string): void => {
        if (path.length >= MAX_RING_LENGTH) return;
        path.push(node);
        visited.add(node);

        for (const next of edges.get(node)?.keys() ?? []) {
          if (next === start && path.length >= 3) {
            const cycleKey = this.canonicalCycle(path);
            if (!reportedCycles.has(cycleKey)) {
              reportedCycles.add(cycleKey);
              this.reviewsAlongCycle(path, edges).forEach((review) =>
                flagReview(
                  review,
                  AbuseSignalType.REVIEW_RING,
                  `Review ring detected: ${cycleKey}`,
                  3,
                ),
              );
            }
          } else if (
            next >= start &&
            !visited.has(next)
          ) {
            walk(next);
          }
        }

        path.pop();
        visited.delete(node);
      };

      walk(start);
    }

    return signals;
  }

  detectRepeatedAgreements(
    agreements: AgreementRecord[],
    threshold: number,
  ): ProposedAbuseSignal[] {
    const counts = new Map<
      string,
      { first: string; second: string; ids: string[] }
    >();
    for (const agreement of agreements) {
      const [first, second] = [...agreement.participantIds].sort();
      const key = `${first}|${second}`;
      const entry = counts.get(key) ?? { first, second, ids: [] };
      entry.ids.push(agreement.id);
      counts.set(key, entry);
    }

    const signals: ProposedAbuseSignal[] = [];
    for (const entry of counts.values()) {
      if (entry.ids.length < threshold) continue;
      signals.push({
        type: AbuseSignalType.REPEATED_AGREEMENT,
        subjectUserId: entry.first,
        actorUserId: entry.second,
        reason: `${entry.ids.length} agreements between ${entry.first} and ${entry.second}`,
        severity: Math.min(5, entry.ids.length - threshold + 1),
        metadata: { count: entry.ids.length, agreementIds: entry.ids, threshold },
      });
    }
    return signals;
  }

  detectNewAccountBursts(
    reviews: ReviewRecord[],
    users: UserRecord[],
    thresholds: {
      minAccountAgeDays: number;
      reviewBurstWindowDays: number;
      reviewBurstThreshold: number;
    },
    now: Date,
  ): ProposedAbuseSignal[] {
    const usersById = new Map(users.map((user) => [user.id, user]));
    const byReviewer = new Map<string, ReviewRecord[]>();
    for (const review of reviews) {
      byReviewer.set(review.reviewerId, [
        ...(byReviewer.get(review.reviewerId) ?? []),
        review,
      ]);
    }

    const signals: ProposedAbuseSignal[] = [];
    for (const [reviewerId, authored] of byReviewer) {
      const user = usersById.get(reviewerId);
      if (!user) continue;
      const accountAgeDays = (now.getTime() - user.createdAt.getTime()) / DAY_MS;
      if (accountAgeDays >= thresholds.minAccountAgeDays) continue;

      const windowStart = now.getTime() - thresholds.reviewBurstWindowDays * DAY_MS;
      const burst = authored.filter(
        (review) => review.createdAt.getTime() >= windowStart,
      );
      if (burst.length < thresholds.reviewBurstThreshold) continue;

      for (const review of burst) {
        signals.push({
          type: AbuseSignalType.NEW_ACCOUNT_BURST,
          reviewId: review.id,
          actorUserId: reviewerId,
          subjectUserId: review.revieweeId,
          reason: `New account ${reviewerId} authored ${burst.length} reviews within ${thresholds.reviewBurstWindowDays} days`,
          severity: 2,
          metadata: { burstSize: burst.length, accountAgeDays },
        });
      }
    }
    return signals;
  }

  detectSharedSignals(
    shared: SharedSignalRecord[],
  ): ProposedAbuseSignal[] {
    const signals: ProposedAbuseSignal[] = [];
    for (const entry of shared) {
      if (entry.userIds.length < 2) continue;
      for (const userId of entry.userIds) {
        signals.push({
          type: entry.type as AbuseSignalType,
          reviewId: entry.reviewId,
          subjectUserId: userId,
          hashedValue: entry.hashedValue,
          reason: `${entry.type} shared by ${entry.userIds.length} accounts`,
          severity: 2,
          metadata: { accountCount: entry.userIds.length },
        });
      }
    }
    return signals;
  }

  private canonicalCycle(path: string[]): string {
    const rotations = path.map((_, offset) =>
      [...path.slice(offset), ...path.slice(0, offset)].join('->'),
    );
    return rotations.sort()[0];
  }

  private reviewsAlongCycle(
    path: string[],
    edges: EdgeMap,
  ): ReviewRecord[] {
    return path
      .map((from, index) => {
        const to = path[(index + 1) % path.length];
        return edges.get(from)?.get(to)?.[0];
      })
      .filter((review): review is ReviewRecord => review !== undefined);
  }
}
