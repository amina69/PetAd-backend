import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrustProjectionService } from '../trust/trust-projection.service';
import { ReviewSummaryService } from './review-summary.service';
import { ModerationQueueDto } from './dto/moderation-queue.dto';
import { ReportReviewDto } from './dto/report-review.dto';

export type ModerationAction = 'HIDE' | 'RESTORE' | 'DELETE';

@Injectable()
export class ReviewModerationService {
  private readonly logger = new Logger(ReviewModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly summary: ReviewSummaryService,
    private readonly trustProjection: TrustProjectionService,
  ) {}

  /**
   * Files a report. A user can only report the same review once; duplicates
   * are ignored rather than rejected so retries stay idempotent.
   */
  async report(reviewId: string, reporterId: string, dto: ReportReviewDto) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, status: true },
    });

    if (!review || review.status === ReviewStatus.DELETED) {
      throw new NotFoundException('Review not found');
    }

    const reason = (dto.reason ?? '').trim();

    const existing = await this.prisma.reviewReport.findUnique({
      where: { reviewId_reporterId: { reviewId, reporterId } },
    });

    if (existing) {
      return {
        id: existing.id,
        reviewId,
        status: existing.status,
        duplicate: true,
        message: 'This review has already been reported by you',
      };
    }

    try {
      const report = await this.prisma.reviewReport.create({
        data: { reviewId, reporterId, reason },
      });

      await this.events.logEvent({
        entityType: 'REVIEW',
        entityId: reviewId,
        eventType: 'REVIEW_REPORTED',
        actorId: reporterId,
        payload: { reportId: report.id, reason },
      });

      return {
        id: report.id,
        reviewId,
        status: report.status,
        duplicate: false,
        message: 'Report received and queued for moderation',
      };
    } catch (error) {
      // Unique constraint: a concurrent duplicate report.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const report = await this.prisma.reviewReport.findUnique({
          where: { reviewId_reporterId: { reviewId, reporterId } },
        });

        return {
          id: report?.id ?? null,
          reviewId,
          status: report?.status ?? null,
          duplicate: true,
          message: 'This review has already been reported by you',
        };
      }

      throw error;
    }
  }

  /** Admin queue of reported reviews. */
  async queue(query: ModerationQueueDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const status = query.status ?? 'OPEN';

    const where: Prisma.ReviewReportWhereInput = { status };

    const [reports, total] = await Promise.all([
      this.prisma.reviewReport.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          review: {
            select: {
              id: true,
              rating: true,
              comment: true,
              status: true,
              authorId: true,
              subjectId: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.reviewReport.count({ where }),
    ]);

    return {
      data: reports.map((report) => ({
        id: report.id,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
        reporterId: report.reporterId,
        review: report.review,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async hide(reviewId: string, moderatorId: string, reason: string) {
    return this.moderate(reviewId, moderatorId, 'HIDE', reason);
  }

  async restore(reviewId: string, moderatorId: string, reason: string) {
    return this.moderate(reviewId, moderatorId, 'RESTORE', reason);
  }

  /**
   * Deletes a review from public view. The row and its content are retained
   * (status DELETED) so moderation remains auditable.
   */
  async remove(reviewId: string, moderatorId: string, reason: string) {
    return this.moderate(reviewId, moderatorId, 'DELETE', reason);
  }

  private async moderate(
    reviewId: string,
    moderatorId: string,
    action: ModerationAction,
    rawReason: string,
  ) {
    const reason = (rawReason ?? '').trim();

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        status: true,
        authorId: true,
        subjectId: true,
      },
    });

    if (
      !review ||
      (review.status === ReviewStatus.DELETED && action !== 'DELETE')
    ) {
      throw new NotFoundException('Review not found');
    }

    const targetStatus: ReviewStatus =
      action === 'HIDE'
        ? ReviewStatus.HIDDEN
        : action === 'RESTORE'
          ? ReviewStatus.VISIBLE
          : ReviewStatus.DELETED;

    if (review.status === targetStatus) {
      throw new ConflictException({
        code: 'REVIEW_ALREADY_IN_STATE',
        message: `Review is already ${targetStatus.toLowerCase()}`,
      });
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        status: targetStatus,
        moderationReason: reason,
        moderatedById: moderatorId,
        moderatedAt: new Date(),
      },
    });

    if (action !== 'RESTORE') {
      await this.prisma.reviewReport.updateMany({
        where: { reviewId, status: 'OPEN' },
        data: {
          status: 'RESOLVED',
          resolvedById: moderatorId,
          resolutionNote: reason,
          resolvedAt: new Date(),
        },
      });
    }

    // Hidden/deleted reviews must no longer influence the public rating, and
    // the trust inputs (badges) are refreshed for the review subject.
    const summary = await this.summary.recompute(review.subjectId);
    await this.trustProjection.recalculate(review.subjectId);

    const eventType =
      action === 'HIDE'
        ? 'REVIEW_HIDDEN'
        : action === 'RESTORE'
          ? 'REVIEW_RESTORED'
          : 'REVIEW_DELETED';

    await this.events.logEvent({
      entityType: 'REVIEW',
      entityId: reviewId,
      eventType,
      actorId: moderatorId,
      payload: {
        reason,
        subjectId: review.subjectId,
        status: targetStatus,
      },
    });

    const outcomeText: Record<ModerationAction, string> = {
      HIDE: 'hidden',
      RESTORE: 'restored',
      DELETE: 'removed',
    };

    await this.notifications.notifyUser(review.authorId, {
      subject: `Your review was ${outcomeText[action]}`,
      text: `A moderator ${outcomeText[action]} your review. Reason: ${reason}`,
    });

    this.logger.log(
      `Review ${reviewId} ${outcomeText[action]} by ${moderatorId} (${reason})`,
    );

    return {
      id: updated.id,
      status: updated.status,
      moderationReason: updated.moderationReason,
      moderatedAt: updated.moderatedAt,
      subjectId: review.subjectId,
      ratingSummary: summary,
    };
  }
}
