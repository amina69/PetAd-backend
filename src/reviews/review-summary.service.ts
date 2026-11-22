import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

/**
 * Rating summaries are derived only from VISIBLE reviews and stored on the
 * user so the public profile never has to aggregate reviews at request time.
 * Moderation recomputes them after every hide/restore/delete decision.
 */
@Injectable()
export class ReviewSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async recompute(subjectId: string): Promise<{
    average: number;
    count: number;
  }> {
    const aggregate = await this.prisma.review.aggregate({
      where: { subjectId, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const count = aggregate._count?._all ?? 0;
    const average =
      count > 0 && aggregate._avg?.rating !== null
        ? Number((aggregate._avg?.rating ?? 0).toFixed(2))
        : null;

    await this.prisma.user.update({
      where: { id: subjectId },
      data: { ratingAverage: average, ratingCount: count },
    });

    await this.events.logEvent({
      entityType: 'USER',
      entityId: subjectId,
      eventType: 'RATING_SUMMARY_UPDATED',
      payload: { average: average ?? 0, count },
    });

    return { average: average ?? 0, count };
  }
}
