import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AbuseFlagStatus, ReviewStatus } from '@prisma/client';
import { AntiAbuseService } from './anti-abuse.service';
import { AntiAbuseDetector } from './anti-abuse.detector';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';

describe('AntiAbuseService', () => {
  let service: AntiAbuseService;

  const now = new Date('2026-11-21T00:00:00.000Z');
  const recentReviews = [
    {
      id: 'r1',
      reviewerId: 'a',
      revieweeId: 'b',
      rating: 5,
      createdAt: now,
      deviceHash: null,
      ipHash: null,
    },
    {
      id: 'r2',
      reviewerId: 'b',
      revieweeId: 'a',
      rating: 5,
      createdAt: now,
      deviceHash: null,
      ipHash: null,
    },
  ];

  const mockPrisma = {
    review: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    adoption: { findMany: jest.fn() },
    custody: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    abuseSignal: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
  const mockLogging = { log: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.review.findUnique.mockResolvedValue(recentReviews[0]);
    mockPrisma.review.findMany.mockResolvedValue(recentReviews);
    mockPrisma.adoption.findMany.mockResolvedValue([]);
    mockPrisma.custody.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'a', createdAt: new Date('2020-01-01') },
      { id: 'b', createdAt: new Date('2020-01-01') },
    ]);
    mockPrisma.abuseSignal.findMany.mockResolvedValue([]);
    mockPrisma.abuseSignal.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AntiAbuseService,
        AntiAbuseDetector,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LoggingService, useValue: mockLogging },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();
    service = module.get(AntiAbuseService);
  });

  it('queues signals and down-weights flagged reviews without punishing users', async () => {
    const signals = await service.evaluateReview('r1');

    expect(signals).toHaveLength(2);
    expect(mockPrisma.abuseSignal.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            reviewId: 'r1',
            reason: expect.stringMatching(/reciprocal/i),
            status: AbuseFlagStatus.PENDING,
          }),
        ]),
      }),
    );
    expect(mockPrisma.review.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2'] } },
      data: { status: ReviewStatus.FLAGGED, weight: 0.2 },
    });
    expect(mockPrisma.user.update).toBeUndefined();
    expect(mockLogging.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TRUST_ABUSE_FLAGGED' }),
    );
  });

  it('keeps flagged reviews visible to admins together with the reason', async () => {
    const signal = {
      id: 'signal-1',
      reviewId: 'r1',
      type: 'RECIPROCAL_REVIEW',
      reason: 'Reciprocal reviews between a and b',
      status: AbuseFlagStatus.PENDING,
    };
    mockPrisma.abuseSignal.findMany.mockResolvedValue([signal]);
    mockPrisma.review.findMany.mockResolvedValue([
      { ...recentReviews[0], status: ReviewStatus.FLAGGED, weight: 0.2 },
    ]);

    const flagged = await service.getFlaggedReviews();

    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/reciprocal/i);
    expect(flagged[0].review?.status).toBe(ReviewStatus.FLAGGED);
  });

  it('hides a review only after a moderator confirms the signal', async () => {
    mockPrisma.abuseSignal.findUnique.mockResolvedValue({
      id: 'signal-1',
      reviewId: 'r1',
    });
    mockPrisma.abuseSignal.update.mockResolvedValue({
      id: 'signal-1',
      status: AbuseFlagStatus.CONFIRMED,
    });

    await service.resolveSignal('signal-1', AbuseFlagStatus.CONFIRMED, 'admin-1');

    expect(mockPrisma.review.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: ReviewStatus.HIDDEN, weight: 0 },
    });
  });

  it('restores weight when the last pending signal is dismissed', async () => {
    mockPrisma.abuseSignal.findUnique.mockResolvedValue({
      id: 'signal-1',
      reviewId: 'r1',
    });
    mockPrisma.abuseSignal.update.mockResolvedValue({
      id: 'signal-1',
      status: AbuseFlagStatus.DISMISSED,
    });
    mockPrisma.abuseSignal.count.mockResolvedValue(0);

    await service.resolveSignal('signal-1', AbuseFlagStatus.DISMISSED, 'admin-1');

    expect(mockPrisma.review.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: ReviewStatus.VISIBLE, weight: 1 },
    });
  });
});
