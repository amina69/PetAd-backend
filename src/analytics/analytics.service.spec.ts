import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsGranularity } from './dto/analytics-overview-query.dto';
import { EscrowStatus } from '@prisma/client';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    user: { findMany: jest.Mock };
    pet: { findMany: jest.Mock };
    adoption: { findMany: jest.Mock };
    custody: { findMany: jest.Mock };
    escrow: { findMany: jest.Mock };
    eventLog: { findMany: jest.Mock };
  };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      pet: { findMany: jest.fn().mockResolvedValue([]) },
      adoption: { findMany: jest.fn().mockResolvedValue([]) },
      custody: { findMany: jest.fn().mockResolvedValue([]) },
      escrow: { findMany: jest.fn().mockResolvedValue([]) },
      eventLog: { findMany: jest.fn().mockResolvedValue([]) },
    };

    configService = {
      get: jest.fn().mockReturnValue(null), // Redis disabled in test
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    await service.clearCache();
  });

  afterEach(async () => {
    await service.clearCache();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Validation & Date Parsing (Strict UTC)', () => {
    it('should throw BadRequestException if from > to', async () => {
      await expect(
        service.getOverview({
          from: '2026-11-10',
          to: '2026-11-05',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if date format is invalid', async () => {
      await expect(
        service.getOverview({
          from: 'invalid-date',
          to: '2026-11-05',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use UTC time zone and return UTC ISO strings for from/to', async () => {
      const result = await service.getOverview({
        from: '2026-11-01',
        to: '2026-11-03',
      });

      expect(result.timeZone).toBe('UTC');
      expect(result.from).toBe('2026-11-01T00:00:00.000Z');
      expect(result.to).toBe('2026-11-03T23:59:59.999Z');
    });
  });

  describe('Acceptance Criteria: Empty Days and Totals Sum', () => {
    it('should cover every day in range with zeros for empty days', async () => {
      const result = await service.getOverview({
        from: '2026-11-01',
        to: '2026-11-04',
      });

      expect(result.series).toHaveLength(4);
      expect(result.series.map((s) => s.date)).toEqual([
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
      ]);

      for (const day of result.series) {
        expect(day.newUsers).toBe(0);
        expect(day.listings).toBe(0);
        expect(day.requests).toBe(0);
        expect(day.completions).toBe(0);
        expect(day.activeCustody).toBe(0);
        expect(day.disputeRate).toBe(0);
        expect(day.escrowVolume).toBe(0);
      }

      expect(result.totals).toEqual({
        newUsers: 0,
        listings: 0,
        requests: 0,
        completions: 0,
        activeCustody: 0,
        disputeRate: 0,
        escrowVolume: 0,
      });
    });

    it('should ensure totals strictly equal the sum of the series', async () => {
      // Mock data on specific UTC dates
      prisma.user.findMany.mockResolvedValue([
        { createdAt: new Date('2026-11-01T10:00:00.000Z') },
        { createdAt: new Date('2026-11-01T15:00:00.000Z') },
        { createdAt: new Date('2026-11-03T08:30:00.000Z') },
      ]);

      prisma.pet.findMany.mockResolvedValue([
        { createdAt: new Date('2026-11-02T12:00:00.000Z') },
      ]);

      prisma.adoption.findMany.mockImplementation(
        (args?: { where?: { status?: unknown } }) => {
          if (args?.where?.status) {
            // Completions fallback query
            return Promise.resolve([
              { updatedAt: new Date('2026-11-03T14:00:00.000Z') },
            ]);
          }
          // Requests query
          return Promise.resolve([
            { createdAt: new Date('2026-11-01T11:00:00.000Z') },
            { createdAt: new Date('2026-11-02T16:00:00.000Z') },
            { createdAt: new Date('2026-11-03T19:00:00.000Z') },
          ]);
        },
      );

      prisma.custody.findMany.mockResolvedValue([
        {
          startDate: new Date('2026-11-02T09:00:00.000Z'),
          createdAt: new Date('2026-11-02T09:00:00.000Z'),
        },
      ]);

      prisma.escrow.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-11-01T12:00:00.000Z'),
          amount: '150.50',
          status: EscrowStatus.FUNDED,
        },
        {
          createdAt: new Date('2026-11-01T14:00:00.000Z'),
          amount: '50.00',
          status: EscrowStatus.DISPUTED,
        },
        {
          createdAt: new Date('2026-11-03T10:00:00.000Z'),
          amount: '300.00',
          status: EscrowStatus.RELEASED,
        },
      ]);

      const result = await service.getOverview({
        from: '2026-11-01',
        to: '2026-11-03',
      });

      expect(result.series).toHaveLength(3);

      // Verify day 1: 2026-11-01
      expect(result.series[0].date).toBe('2026-11-01');
      expect(result.series[0].newUsers).toBe(2);
      expect(result.series[0].listings).toBe(0);
      expect(result.series[0].requests).toBe(1);
      expect(result.series[0].completions).toBe(0);
      expect(result.series[0].activeCustody).toBe(0);
      expect(result.series[0].escrowVolume).toBe(200.5);
      expect(result.series[0].disputeRate).toBe(0.5); // 1 disputed out of 2 escrows

      // Verify day 2: 2026-11-02
      expect(result.series[1].date).toBe('2026-11-02');
      expect(result.series[1].newUsers).toBe(0);
      expect(result.series[1].listings).toBe(1);
      expect(result.series[1].requests).toBe(1);
      expect(result.series[1].completions).toBe(0);
      expect(result.series[1].activeCustody).toBe(1);
      expect(result.series[1].escrowVolume).toBe(0);
      expect(result.series[1].disputeRate).toBe(0);

      // Verify day 3: 2026-11-03
      expect(result.series[2].date).toBe('2026-11-03');
      expect(result.series[2].newUsers).toBe(1);
      expect(result.series[2].listings).toBe(0);
      expect(result.series[2].requests).toBe(1);
      expect(result.series[2].completions).toBe(1);
      expect(result.series[2].activeCustody).toBe(0);
      expect(result.series[2].escrowVolume).toBe(300);
      expect(result.series[2].disputeRate).toBe(0);

      // Verify Acceptance Criteria: Totals equal the sum of the series
      expect(result.totals.newUsers).toBe(
        result.series.reduce((sum, d) => sum + d.newUsers, 0),
      );
      expect(result.totals.listings).toBe(
        result.series.reduce((sum, d) => sum + d.listings, 0),
      );
      expect(result.totals.requests).toBe(
        result.series.reduce((sum, d) => sum + d.requests, 0),
      );
      expect(result.totals.completions).toBe(
        result.series.reduce((sum, d) => sum + d.completions, 0),
      );
      expect(result.totals.activeCustody).toBe(
        result.series.reduce((sum, d) => sum + d.activeCustody, 0),
      );
      expect(result.totals.disputeRate).toBeCloseTo(
        result.series.reduce((sum, d) => sum + d.disputeRate, 0),
      );
      expect(result.totals.escrowVolume).toBeCloseTo(
        result.series.reduce((sum, d) => sum + d.escrowVolume, 0),
      );
    });
  });

  describe('Caching', () => {
    it('should cache overview results and return cached response on subsequent calls', async () => {
      prisma.user.findMany.mockResolvedValue([
        { createdAt: new Date('2026-11-01T10:00:00.000Z') },
      ]);

      const query = {
        from: '2026-11-01',
        to: '2026-11-02',
        granularity: AnalyticsGranularity.DAY,
      };

      const firstResult = await service.getOverview(query);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);

      // Call again with same query
      const secondResult = await service.getOverview(query);
      // DB shouldn't be queried a second time
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(secondResult).toEqual(firstResult);

      // Invalidate cache
      await service.clearCache();

      // Call again - DB should be queried
      const thirdResult = await service.getOverview(query);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
      expect(thirdResult).toEqual(firstResult);
    });
  });
});
