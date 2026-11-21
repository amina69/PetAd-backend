import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EventEntityType,
  EventType,
  Prisma,
  ReviewAgreementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PaginationMetaDto } from '../common/dto/paginated-response.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { TrustProjectionService } from '../trust/trust-projection.service';
import {
  CreateReviewDto,
  CreateReviewReportDto,
  CreateReviewResponseDto,
  ListReviewsQueryDto,
} from './dto/review.dto';

const REVIEW_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const COMPLETION_EVENTS: Record<ReviewAgreementType, EventType[]> = {
  [ReviewAgreementType.ADOPTION]: [EventType.ADOPTION_COMPLETED],
  [ReviewAgreementType.CUSTODY]: [
    EventType.CUSTODY_COMPLETED,
    EventType.CUSTODY_RETURNED,
  ],
};

interface AgreementContext {
  parties: string[];
  completedAt: Date | null;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly trustProjection: TrustProjectionService,
  ) {}

  async createReview(
    reviewerId: string,
    agreementType: ReviewAgreementType,
    agreementId: string,
    dto: CreateReviewDto,
  ) {
    const agreement = await this.loadAgreement(agreementType, agreementId);
    const otherParties = agreement.parties.filter((id) => id !== reviewerId);
    const subjectId = otherParties[0];

    if (!agreement.parties.includes(reviewerId) || !subjectId) {
      throw new NotFoundException('Agreement not found');
    }
    if (!agreement.completedAt) {
      throw new ForbiddenException({
        code: ErrorCode.REVIEW_NOT_ALLOWED,
        message: 'Only completed agreements can be reviewed',
      });
    }
    if (
      Date.now() - agreement.completedAt.getTime() >
      REVIEW_WINDOW_DAYS * DAY_MS
    ) {
      throw new ForbiddenException({
        code: ErrorCode.REVIEW_WINDOW_EXPIRED,
        message: `Reviews must be submitted within ${REVIEW_WINDOW_DAYS} days of completion`,
      });
    }

    const agreementField =
      agreementType === ReviewAgreementType.ADOPTION
        ? { adoptionId: agreementId }
        : { custodyId: agreementId };

    try {
      const review = await this.prisma.review.create({
        data: {
          rating: dto.rating,
          title: dto.title,
          body: dto.body,
          reviewerId,
          subjectId,
          agreementType,
          ...agreementField,
        },
        include: {
          reviewer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
          response: true,
        },
      });

      const event = await this.events.logEvent({
        entityType: 'REVIEW' as EventEntityType,
        entityId: review.id,
        eventType: EventType.REVIEW_CREATED,
        actorId: reviewerId,
        payload: {
          reviewId: review.id,
          subjectId,
          rating: review.rating,
          agreementType,
          agreementId,
        },
      });

      void this.trustProjection.processSourceEvent(event.id).catch((error) => {
        this.logger.error(
          `Unable to project review ${review.id} into trust scores`,
          error instanceof Error ? error.stack : String(error),
        );
      });

      return this.mapReview(review);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCode.ALREADY_REVIEWED,
          message: 'You have already reviewed this agreement',
        });
      }
      throw error;
    }
  }

  async respond(
    reviewId: string,
    responderId: string,
    dto: CreateReviewResponseDto,
  ) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, subjectId: true, response: { select: { id: true } } },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.subjectId !== responderId) {
      throw new ForbiddenException({
        code: ErrorCode.REVIEW_NOT_ALLOWED,
        message: 'Only the review subject may respond',
      });
    }
    if (review.response) {
      throw new ConflictException({
        code: ErrorCode.ALREADY_RESPONDED,
        message: 'A response has already been posted',
      });
    }

    return this.prisma.reviewResponse.create({
      data: {
        reviewId,
        responderId,
        body: dto.body,
      },
      select: {
        id: true,
        reviewId: true,
        responderId: true,
        body: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async report(
    reviewId: string,
    reporterId: string,
    dto: CreateReviewReportDto,
  ) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, reviewerId: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.reviewerId === reporterId) {
      throw new ForbiddenException({
        code: ErrorCode.REVIEW_NOT_ALLOWED,
        message: 'You cannot report your own review',
      });
    }

    try {
      return await this.prisma.reviewReport.create({
        data: {
          reviewId,
          reporterId,
          reason: dto.reason,
          details: dto.details,
        },
        select: {
          id: true,
          reviewId: true,
          reason: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCode.ALREADY_REPORTED,
          message: 'You have already reported this review',
        });
      }
      throw error;
    }
  }

  async listForUser(userId: string, query: ListReviewsQueryDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw new NotFoundException('User not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ReviewWhereInput = {
      subjectId: userId,
      ...(query.rating ? { rating: query.rating } : {}),
    };
    const orderBy: Prisma.ReviewOrderByWithRelationInput =
      query.sort === 'highest'
        ? { rating: 'desc' }
        : query.sort === 'lowest'
          ? { rating: 'asc' }
          : { createdAt: 'desc' };

    const [reviews, total, distribution] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: [{ ...orderBy }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          reviewer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
          response: {
            select: {
              id: true,
              body: true,
              responderId: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { subjectId: userId },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map(
      distribution.map((row) => [row.rating, row._count._all]),
    );
    const summary = {
      average: this.averageFromDistribution(counts),
      count: Array.from(counts.values()).reduce((sum, value) => sum + value, 0),
      distribution: {
        1: counts.get(1) ?? 0,
        2: counts.get(2) ?? 0,
        3: counts.get(3) ?? 0,
        4: counts.get(4) ?? 0,
        5: counts.get(5) ?? 0,
      },
    };

    return {
      data: reviews.map((review) => this.mapReview(review)),
      meta: new PaginationMetaDto(page, limit, total),
      summary,
    };
  }

  private async loadAgreement(
    agreementType: ReviewAgreementType,
    agreementId: string,
  ): Promise<AgreementContext> {
    if (agreementType === ReviewAgreementType.ADOPTION) {
      const adoption = await this.prisma.adoption.findUnique({
        where: { id: agreementId },
        select: {
          status: true,
          adopterId: true,
          ownerId: true,
          updatedAt: true,
        },
      });
      if (!adoption) throw new NotFoundException('Agreement not found');
      const completedAt = await this.completionTime(
        EventEntityType.ADOPTION,
        agreementId,
        COMPLETION_EVENTS[agreementType],
        adoption.status === 'COMPLETED' ? adoption.updatedAt : null,
      );
      return {
        parties: [adoption.adopterId, adoption.ownerId],
        completedAt: adoption.status === 'COMPLETED' ? completedAt : null,
      };
    }

    const custody = await this.prisma.custody.findUnique({
      where: { id: agreementId },
      select: {
        status: true,
        holderId: true,
        endDate: true,
        updatedAt: true,
        pet: { select: { currentOwnerId: true } },
      },
    });
    if (!custody) throw new NotFoundException('Agreement not found');
    const isCompleted =
      custody.status === 'COMPLETED' || custody.status === 'RETURNED';
    const completedAt = await this.completionTime(
      EventEntityType.CUSTODY,
      agreementId,
      COMPLETION_EVENTS[agreementType],
      custody.endDate ?? (isCompleted ? custody.updatedAt : null),
    );

    return {
      parties: [custody.holderId, custody.pet.currentOwnerId].filter(
        (id): id is string => Boolean(id),
      ),
      completedAt: isCompleted ? completedAt : null,
    };
  }

  private async completionTime(
    entityType: EventEntityType,
    entityId: string,
    eventTypes: EventType[],
    fallback: Date | null,
  ): Promise<Date | null> {
    const event = await this.prisma.eventLog.findFirst({
      where: { entityType, entityId, eventType: { in: eventTypes } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return event?.createdAt ?? fallback;
  }

  private averageFromDistribution(counts: Map<number, number>): number {
    let total = 0;
    let weighted = 0;
    for (const [rating, count] of counts.entries()) {
      total += count;
      weighted += rating * count;
    }
    return total === 0 ? 0 : Math.round((weighted / total) * 10) / 10;
  }

  private mapReview(review: {
    id: string;
    rating: number;
    title: string;
    body: string;
    reviewerId: string;
    subjectId: string;
    agreementType: ReviewAgreementType;
    createdAt: Date;
    updatedAt: Date;
    reviewer?: unknown;
    response?: unknown;
  }) {
    return {
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      reviewerId: review.reviewerId,
      subjectId: review.subjectId,
      agreementType: review.agreementType,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      reviewer: review.reviewer ?? null,
      response: review.response ?? null,
    };
  }
}
