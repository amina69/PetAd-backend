import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnalyticsOverviewQueryDto,
  AnalyticsGranularity,
} from './dto/analytics-overview-query.dto';
import {
  AnalyticsOverviewResponseDto,
  DailyMetricsDto,
  MetricsTotalsDto,
} from './dto/analytics-overview-response.dto';
import {
  AdoptionStatus,
  CustodyStatus,
  EscrowStatus,
  EventType,
} from '@prisma/client';

interface CachedEntry {
  expiresAt: number;
  data: AnalyticsOverviewResponseDto;
}

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly memoryCache = new Map<string, CachedEntry>();
  private redisClient: Redis | null = null;
  private readonly defaultTtlSeconds = 60; // 1 minute cache TTL

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.initRedis();
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  private initRedis() {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL');
      if (redisUrl) {
        this.redisClient = new Redis(redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        this.redisClient.connect().catch((err: unknown) => {
          this.logger.warn(
            `Redis connection error for analytics cache, using in-memory fallback: ${this.getErrorMessage(err)}`,
          );
          this.redisClient = null;
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to initialize Redis for analytics cache: ${this.getErrorMessage(err)}`,
      );
      this.redisClient = null;
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // ignore disconnect errors during shutdown
      }
    }
  }

  /**
   * Helper to clear memory & redis cache (useful for testing or cache invalidation).
   */
  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    if (this.redisClient) {
      try {
        const keys = await this.redisClient.keys('analytics:*');
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * GET /admin/analytics/overview
   *
   * Evaluates platform metrics over the requested date range strictly in UTC.
   * Series covers every single day in the range with zeros for empty days.
   * Totals equal the sum of the series.
   */
  async getOverview(
    query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewResponseDto> {
    const { fromStr, toStr, granularity } = this.normalizeQuery(query);
    const { from, to, dates } = this.parseUtcDateRange(fromStr, toStr);

    const cacheKey = `analytics:overview:${from.toISOString()}:${to.toISOString()}:${granularity}`;

    // 1. Check cache
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Initialize day buckets with zeros for every single day in range
    const buckets: Record<string, DailyMetricsDto> = {};
    for (const d of dates) {
      buckets[d] = {
        date: d,
        newUsers: 0,
        listings: 0,
        requests: 0,
        completions: 0,
        activeCustody: 0,
        disputeRate: 0,
        escrowVolume: 0,
      };
    }

    // 3. Query metrics from DB within the UTC date range
    await Promise.all([
      this.fetchNewUsers(from, to, buckets),
      this.fetchListings(from, to, buckets),
      this.fetchRequests(from, to, buckets),
      this.fetchCompletions(from, to, buckets),
      this.fetchActiveCustody(from, to, buckets),
      this.fetchEscrowsAndDisputes(from, to, dates, buckets),
    ]);

    // 4. Construct time series (ordered by date ascending)
    const series: DailyMetricsDto[] = dates.map((d) => buckets[d]);

    // 5. Compute totals as the exact sum of the series (Acceptance criterion: Totals equal the sum of the series)
    const totals: MetricsTotalsDto = {
      newUsers: series.reduce((acc, curr) => acc + curr.newUsers, 0),
      listings: series.reduce((acc, curr) => acc + curr.listings, 0),
      requests: series.reduce((acc, curr) => acc + curr.requests, 0),
      completions: series.reduce((acc, curr) => acc + curr.completions, 0),
      activeCustody: series.reduce((acc, curr) => acc + curr.activeCustody, 0),
      disputeRate: Number(
        series.reduce((acc, curr) => acc + curr.disputeRate, 0).toFixed(4),
      ),
      escrowVolume: Number(
        series.reduce((acc, curr) => acc + curr.escrowVolume, 0).toFixed(2),
      ),
    };

    const response: AnalyticsOverviewResponseDto = {
      timeZone: 'UTC',
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      totals,
      series,
    };

    // 6. Save in cache
    await this.setInCache(cacheKey, response);

    return response;
  }

  private normalizeQuery(query: AnalyticsOverviewQueryDto) {
    const granularity = query.granularity ?? AnalyticsGranularity.DAY;
    return {
      fromStr: query.from,
      toStr: query.to,
      granularity,
    };
  }

  /**
   * Strictly parse and normalize date boundaries into UTC.
   * - If 'YYYY-MM-DD' is given for 'from', start at 00:00:00.000Z.
   * - If 'YYYY-MM-DD' is given for 'to', end at 23:59:59.999Z.
   * Generates continuous list of UTC dates YYYY-MM-DD.
   */
  private parseUtcDateRange(
    fromStr?: string,
    toStr?: string,
  ): { from: Date; to: Date; dates: string[] } {
    const now = new Date();

    let to: Date;
    if (toStr) {
      if (toStr.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
        const [y, m, d] = toStr.split('-').map(Number);
        to = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      } else {
        to = new Date(toStr);
      }
      if (isNaN(to.getTime())) {
        throw new BadRequestException(`Invalid "to" date format: ${toStr}`);
      }
    } else {
      to = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
    }

    let from: Date;
    if (fromStr) {
      if (fromStr.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
        const [y, m, d] = fromStr.split('-').map(Number);
        from = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      } else {
        from = new Date(fromStr);
      }
      if (isNaN(from.getTime())) {
        throw new BadRequestException(`Invalid "from" date format: ${fromStr}`);
      }
    } else {
      // Default to 29 days before 'to' (30 days total)
      const toDateOnly = new Date(
        Date.UTC(
          to.getUTCFullYear(),
          to.getUTCMonth(),
          to.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );
      from = new Date(toDateOnly.getTime() - 29 * 24 * 60 * 60 * 1000);
    }

    if (from.getTime() > to.getTime()) {
      throw new BadRequestException(
        '"from" date must be earlier than or equal to "to" date',
      );
    }

    // Generate every UTC day between from and to
    const dates: string[] = [];
    const current = new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const end = new Date(
      Date.UTC(
        to.getUTCFullYear(),
        to.getUTCMonth(),
        to.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    while (current.getTime() <= end.getTime()) {
      const yyyy = current.getUTCFullYear();
      const mm = String(current.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(current.getUTCDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return { from, to, dates };
  }

  private toUtcDateString(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private async fetchNewUsers(
    from: Date,
    to: Date,
    buckets: Record<string, DailyMetricsDto>,
  ) {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          createdAt: { gte: from, lte: to },
        },
        select: { createdAt: true },
      });
      for (const u of users) {
        const d = this.toUtcDateString(u.createdAt);
        if (buckets[d]) {
          buckets[d].newUsers += 1;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Error querying new users: ${this.getErrorMessage(err)}`,
      );
    }
  }

  private async fetchListings(
    from: Date,
    to: Date,
    buckets: Record<string, DailyMetricsDto>,
  ) {
    try {
      const pets = await this.prisma.pet.findMany({
        where: {
          createdAt: { gte: from, lte: to },
        },
        select: { createdAt: true },
      });
      for (const p of pets) {
        const d = this.toUtcDateString(p.createdAt);
        if (buckets[d]) {
          buckets[d].listings += 1;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Error querying pet listings: ${this.getErrorMessage(err)}`,
      );
    }
  }

  private async fetchRequests(
    from: Date,
    to: Date,
    buckets: Record<string, DailyMetricsDto>,
  ) {
    try {
      const adoptions = await this.prisma.adoption.findMany({
        where: {
          createdAt: { gte: from, lte: to },
        },
        select: { createdAt: true },
      });
      for (const a of adoptions) {
        const d = this.toUtcDateString(a.createdAt);
        if (buckets[d]) {
          buckets[d].requests += 1;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Error querying adoption requests: ${this.getErrorMessage(err)}`,
      );
    }
  }

  private async fetchCompletions(
    from: Date,
    to: Date,
    buckets: Record<string, DailyMetricsDto>,
  ) {
    try {
      // First try eventLog for ADOPTION_COMPLETED if eventLog model exists and has entries
      let completionDates: Date[] = [];
      if (this.prisma.eventLog) {
        try {
          const events = await this.prisma.eventLog.findMany({
            where: {
              eventType: EventType.ADOPTION_COMPLETED,
              createdAt: { gte: from, lte: to },
            },
            select: { createdAt: true },
          });
          if (events && events.length > 0) {
            completionDates = events.map((e) => e.createdAt);
          }
        } catch {
          // ignore if table/model not ready
        }
      }

      if (completionDates.length === 0) {
        const completedAdoptions = await this.prisma.adoption.findMany({
          where: {
            status: AdoptionStatus.COMPLETED,
            updatedAt: { gte: from, lte: to },
          },
          select: { updatedAt: true },
        });
        completionDates = completedAdoptions.map((a) => a.updatedAt);
      }

      for (const date of completionDates) {
        const d = this.toUtcDateString(date);
        if (buckets[d]) {
          buckets[d].completions += 1;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Error querying completions: ${this.getErrorMessage(err)}`,
      );
    }
  }

  private async fetchActiveCustody(
    from: Date,
    to: Date,
    buckets: Record<string, DailyMetricsDto>,
  ) {
    try {
      const custodies = await this.prisma.custody.findMany({
        where: {
          status: CustodyStatus.ACTIVE,
          OR: [
            { startDate: { gte: from, lte: to } },
            { createdAt: { gte: from, lte: to } },
          ],
        },
        select: { startDate: true, createdAt: true },
      });
      for (const c of custodies) {
        const custodyDate = c.startDate ?? c.createdAt;
        const d = this.toUtcDateString(custodyDate);
        if (buckets[d]) {
          buckets[d].activeCustody += 1;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Error querying active custody: ${this.getErrorMessage(err)}`,
      );
    }
  }

  private async fetchEscrowsAndDisputes(
    from: Date,
    to: Date,
    dates: string[],
    buckets: Record<string, DailyMetricsDto>,
  ) {
    try {
      const escrows = await this.prisma.escrow.findMany({
        where: {
          createdAt: { gte: from, lte: to },
        },
        select: { createdAt: true, amount: true, status: true },
      });

      const dailyCounts: Record<string, { total: number; disputed: number }> =
        {};

      for (const e of escrows) {
        const d = this.toUtcDateString(e.createdAt);
        if (buckets[d]) {
          buckets[d].escrowVolume = Number(
            (buckets[d].escrowVolume + Number(e.amount)).toFixed(2),
          );
          if (!dailyCounts[d]) {
            dailyCounts[d] = { total: 0, disputed: 0 };
          }
          dailyCounts[d].total += 1;
          if (e.status === EscrowStatus.DISPUTED) {
            dailyCounts[d].disputed += 1;
          }
        }
      }

      for (const d of dates) {
        const count = dailyCounts[d];
        if (count && count.total > 0) {
          buckets[d].disputeRate = Number(
            (count.disputed / count.total).toFixed(4),
          );
        } else {
          buckets[d].disputeRate = 0;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Error querying escrow volume and disputes: ${this.getErrorMessage(err)}`,
      );
    }
  }

  private async getFromCache(
    key: string,
  ): Promise<AnalyticsOverviewResponseDto | null> {
    // 1. In-memory cache check
    const mem = this.memoryCache.get(key);
    if (mem) {
      if (mem.expiresAt > Date.now()) {
        return mem.data;
      }
      this.memoryCache.delete(key);
    }

    // 2. Redis cache check
    if (this.redisClient) {
      try {
        const data = await this.redisClient.get(key);
        if (data) {
          const parsed = JSON.parse(data) as AnalyticsOverviewResponseDto;
          // Store in memory cache for faster subsequent reads
          this.memoryCache.set(key, {
            expiresAt: Date.now() + this.defaultTtlSeconds * 1000,
            data: parsed,
          });
          return parsed;
        }
      } catch {
        // ignore redis read failure
      }
    }

    return null;
  }

  private async setInCache(
    key: string,
    data: AnalyticsOverviewResponseDto,
  ): Promise<void> {
    this.memoryCache.set(key, {
      expiresAt: Date.now() + this.defaultTtlSeconds * 1000,
      data,
    });

    if (this.redisClient) {
      try {
        await this.redisClient.set(
          key,
          JSON.stringify(data),
          'EX',
          this.defaultTtlSeconds,
        );
      } catch {
        // ignore redis write failure
      }
    }
  }
}
