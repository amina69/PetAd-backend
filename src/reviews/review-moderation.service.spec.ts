import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReviewModerationService } from './review-moderation.service';
import { ReviewSummaryService } from './review-summary.service';

const reviewRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'review-1',
  authorId: 'author-1',
  subjectId: 'subject-1',
  rating: 2,
  comment: 'Never delivered the documents',
  status: 'VISIBLE',
  createdAt: new Date(),
  ...overrides,
});

function build() {
  const prisma = {
    review: {
      findUnique: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    reviewReport: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: { update: jest.fn() },
  };

  const events = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyUser: jest.fn().mockResolvedValue(true) };
  const summary = {
    recompute: jest.fn().mockResolvedValue({ average: 4, count: 1 }),
  };
  const trustProjection = {
    recalculate: jest.fn().mockResolvedValue([]),
  };

  const service = new ReviewModerationService(
    prisma as never,
    events as never,
    notifications as never,
    summary as never,
    trustProjection as never,
  );

  return {
    service,
    prisma,
    events,
    notifications,
    summary,
    trustProjection,
  };
}

describe('ReviewModerationService', () => {
  describe('report', () => {
    it('ignores a duplicate report from the same user', async () => {
      const { service, prisma, events } = build();
      prisma.review.findUnique.mockResolvedValue(reviewRow());
      prisma.reviewReport.findUnique.mockResolvedValue({
        id: 'report-1',
        status: 'OPEN',
      });

      const result = await service.report('review-1', 'reporter-1', {
        reason: 'This review contains personal information',
      });

      expect(result.duplicate).toBe(true);
      expect(prisma.reviewReport.create).not.toHaveBeenCalled();
      expect(events.logEvent).not.toHaveBeenCalled();
    });

    it('queues a first report and logs the event', async () => {
      const { service, prisma, events } = build();
      prisma.review.findUnique.mockResolvedValue(reviewRow());
      prisma.reviewReport.findUnique.mockResolvedValue(null);
      prisma.reviewReport.create.mockResolvedValue({
        id: 'report-1',
        status: 'OPEN',
      });

      const result = await service.report('review-1', 'reporter-1', {
        reason: 'This review contains personal information',
      });

      expect(result.duplicate).toBe(false);
      expect(events.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REVIEW_REPORTED' }),
      );
    });

    it('404s for an unknown review', async () => {
      const { service, prisma } = build();
      prisma.review.findUnique.mockResolvedValue(null);

      await expect(
        service.report('missing', 'reporter-1', {
          reason: 'This review contains personal information',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('hide', () => {
    it('hides the review, recomputes the summary and refreshes trust inputs', async () => {
      const {
        service,
        prisma,
        events,
        summary,
        trustProjection,
        notifications,
      } = build();
      prisma.review.findUnique.mockResolvedValue(reviewRow());
      prisma.review.update.mockResolvedValue(
        reviewRow({ status: 'HIDDEN', moderationReason: 'Abusive language' }),
      );

      const result = await service.hide(
        'review-1',
        'admin-1',
        'Abusive language in the review',
      );

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'HIDDEN' }),
        }),
      );
      expect(prisma.reviewReport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reviewId: 'review-1', status: 'OPEN' },
          data: expect.objectContaining({ status: 'RESOLVED' }),
        }),
      );
      expect(summary.recompute).toHaveBeenCalledWith('subject-1');
      expect(trustProjection.recalculate).toHaveBeenCalledWith('subject-1');
      expect(events.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REVIEW_HIDDEN' }),
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'author-1',
        expect.objectContaining({ subject: 'Your review was hidden' }),
      );
      expect(result.status).toBe('HIDDEN');
    });

    it('refuses to hide a review twice', async () => {
      const { service, prisma } = build();
      prisma.review.findUnique.mockResolvedValue(
        reviewRow({ status: 'HIDDEN' }),
      );

      await expect(
        service.hide('review-1', 'admin-1', 'Abusive language in the review'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('restore', () => {
    it('restores a hidden review and recomputes its summary', async () => {
      const { service, prisma, summary, events } = build();
      prisma.review.findUnique.mockResolvedValue(
        reviewRow({ status: 'HIDDEN' }),
      );
      prisma.review.update.mockResolvedValue(reviewRow({ status: 'VISIBLE' }));

      await service.restore(
        'review-1',
        'admin-1',
        'The report was not justified',
      );

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'VISIBLE' }),
        }),
      );
      expect(summary.recompute).toHaveBeenCalledWith('subject-1');
      expect(events.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REVIEW_RESTORED' }),
      );
    });
  });

  describe('remove', () => {
    it('retains the review for audit while removing it from public view', async () => {
      const { service, prisma, summary } = build();
      prisma.review.findUnique.mockResolvedValue(reviewRow());
      prisma.review.update.mockResolvedValue(reviewRow({ status: 'DELETED' }));

      await service.remove(
        'review-1',
        'admin-1',
        'Review violates the content policy',
      );

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELETED' }),
        }),
      );
      expect(prisma.review.findUnique).toHaveBeenCalled();
      expect(summary.recompute).toHaveBeenCalledWith('subject-1');
    });
  });

  describe('queue', () => {
    it('defaults to open reports', async () => {
      const { service, prisma } = build();
      prisma.reviewReport.findMany.mockResolvedValue([]);
      prisma.reviewReport.count.mockResolvedValue(0);

      await service.queue({});

      expect(prisma.reviewReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'OPEN' } }),
      );
    });
  });
});

describe('ReviewSummaryService', () => {
  it('aggregates only visible reviews into the stored summary', async () => {
    const prisma = {
      review: {
        aggregate: jest.fn().mockResolvedValue({
          _avg: { rating: 4.5 },
          _count: { _all: 2 },
        }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    const events = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const service = new ReviewSummaryService(prisma as never, events as never);

    const result = await service.recompute('subject-1');

    expect(prisma.review.aggregate).toHaveBeenCalledWith({
      where: { subjectId: 'subject-1', status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'subject-1' },
      data: { ratingAverage: 4.5, ratingCount: 2 },
    });
    expect(events.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'RATING_SUMMARY_UPDATED' }),
    );
    expect(result).toEqual({ average: 4.5, count: 2 });
  });

  it('clears the summary when no visible reviews remain', async () => {
    const prisma = {
      review: {
        aggregate: jest.fn().mockResolvedValue({
          _avg: { rating: null },
          _count: { _all: 0 },
        }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    const events = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const service = new ReviewSummaryService(prisma as never, events as never);

    const result = await service.recompute('subject-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'subject-1' },
      data: { ratingAverage: null, ratingCount: 0 },
    });
    expect(result).toEqual({ average: 0, count: 0 });
  });
});
