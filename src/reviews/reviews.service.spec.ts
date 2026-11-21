import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewAgreementType } from '@prisma/client';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const dto = {
    rating: 5,
    title: 'Excellent companion',
    body: 'The care and communication were excellent throughout.',
  };

  function buildService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      custody: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          holderId: 'reviewer-1',
          endDate: new Date(),
          updatedAt: new Date(),
          pet: { currentOwnerId: 'subject-1' },
        }),
      },
      adoption: { findUnique: jest.fn() },
      eventLog: {
        findFirst: jest.fn().mockResolvedValue({ createdAt: new Date() }),
      },
      review: {
        create: jest.fn().mockResolvedValue({
          id: 'review-1',
          rating: 5,
          title: dto.title,
          body: dto.body,
          reviewerId: 'reviewer-1',
          subjectId: 'subject-1',
          agreementType: ReviewAgreementType.CUSTODY,
          createdAt: new Date(),
          updatedAt: new Date(),
          reviewer: null,
          response: null,
        }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      reviewResponse: { create: jest.fn() },
      reviewReport: { create: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subject-1',
          status: 'ACTIVE',
          deletedAt: null,
        }),
      },
      ...overrides,
    };
    const events = { logEvent: jest.fn().mockResolvedValue({ id: 'event-1' }) };
    const trustProjection = {
      processSourceEvent: jest.fn().mockResolvedValue(true),
    };
    const service = new ReviewsService(
      prisma as never,
      events as never,
      trustProjection as never,
    );
    return { service, prisma, events, trustProjection };
  }

  it('returns ALREADY_REVIEWED for a duplicate agreement review', async () => {
    const { service, prisma } = buildService();
    prisma.review.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.createReview(
        'reviewer-1',
        ReviewAgreementType.CUSTODY,
        'custody-1',
        dto,
      ),
    ).rejects.toMatchObject({
      response: { code: 'ALREADY_REVIEWED' },
    } as Partial<ConflictException>);
  });

  it('hides unrelated agreements and rejects non-completed ones', async () => {
    const unrelated = buildService();
    await expect(
      unrelated.service.createReview(
        'stranger-1',
        ReviewAgreementType.CUSTODY,
        'custody-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const incomplete = buildService();
    incomplete.prisma.custody.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      holderId: 'reviewer-1',
      endDate: null,
      updatedAt: new Date(),
      pet: { currentOwnerId: 'subject-1' },
    });
    await expect(
      incomplete.service.createReview(
        'reviewer-1',
        ReviewAgreementType.CUSTODY,
        'custody-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('projects a created review into trust events', async () => {
    const { service, trustProjection } = buildService();

    const review = await service.createReview(
      'reviewer-1',
      ReviewAgreementType.CUSTODY,
      'custody-1',
      dto,
    );

    expect(review).toMatchObject({ subjectId: 'subject-1', rating: 5 });
    expect(trustProjection.processSourceEvent).toHaveBeenCalledWith('event-1');
  });

  it('returns a rating summary with distribution', async () => {
    const { service, prisma } = buildService();
    prisma.review.groupBy.mockResolvedValue([
      { rating: 5, _count: { _all: 3 } },
      { rating: 4, _count: { _all: 1 } },
    ]);

    const result = await service.listForUser('subject-1', {
      page: 1,
      limit: 20,
      sort: 'recent',
    });

    expect(result.summary).toEqual({
      average: 4.8,
      count: 4,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 3 },
    });
  });
});
