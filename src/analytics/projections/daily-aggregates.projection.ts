import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const PROJECTION_KEY = 'daily_aggregates';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EXPIRED_AFTER_DAYS = 30;

interface AggregateRow {
  day: Date;
  species: string;
  age_band: string;
  size: string;
  region: string;
  shelter_id: string;
  [key: string]: Date | string | number;
}

interface Counts {
  requested?: number;
  approved?: number;
  funded?: number;
  completed?: number;
  rejected?: number;
  cancelled?: number;
  expired?: number;
  created?: number;
  started?: number;
  returned?: number;
  violation?: number;
  opened?: number;
  resolved?: number;
  registered?: number;
  suspended?: number;
  reinstated?: number;
  deleted?: number;
}

export interface ProjectionState {
  key: string;
  lastProcessedAt: Date | null;
  lastRunAt: Date;
  rowCount: number;
  refreshLagSeconds: number | null;
  refreshIntervalSeconds: number;
}

@Injectable()
export class DailyAggregatesProjectionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DailyAggregatesProjectionService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.refreshStaleDay().catch((error: unknown) => {
        this.logger.warn(
          `Daily aggregate refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Recomputes the single day affected by a newly appended event. */
  async refreshSince(createdAt: Date): Promise<void> {
    const day = new Date(createdAt);
    const from = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
    );
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    await this.rebuildRange(from, to);
  }

  async refreshStaleDay(): Promise<void> {
    const state = await this.prisma.analyticsProjectionState.findUnique({
      where: { key: PROJECTION_KEY },
    });
    const from = state?.lastProcessedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.refreshSince(from);
  }

  async rebuildAll(): Promise<ProjectionState> {
    return this.rebuildRange(
      new Date('1970-01-01T00:00:00.000Z'),
      new Date('9999-12-31T00:00:00.000Z'),
    );
  }

  async rebuildRange(from: Date, to: Date): Promise<ProjectionState> {
    const expiredCutoff = new Date(
      Date.now() - EXPIRED_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM daily_adoptions WHERE date >= ${from} AND date < ${to}`;
      await tx.$executeRaw`DELETE FROM daily_custody WHERE date >= ${from} AND date < ${to}`;
      await tx.$executeRaw`DELETE FROM daily_disputes WHERE date >= ${from} AND date < ${to}`;
      await tx.$executeRaw`DELETE FROM daily_users WHERE date >= ${from} AND date < ${to}`;

      const adoptionRows = await this.adoptionRows(tx, from, to, expiredCutoff);
      for (const row of adoptionRows) {
        const counts = this.counts(row);
        const where = {
          date: this.asDate(row.day),
          species: row.species,
          ageBand: row.age_band,
          size: row.size,
          region: row.region,
          shelterId: row.shelter_id,
        };
        const data = { ...counts };
        await tx.dailyAdoption.upsert({
          where: { date_species_ageBand_size_region_shelterId: where },
          create: { ...where, ...data },
          update: data,
        });
      }

      const custodyRows = await this.custodyRows(tx, from, to);
      for (const row of custodyRows) {
        const counts = this.counts(row);
        const where = {
          date: this.asDate(row.day),
          species: row.species,
          region: row.region,
          shelterId: row.shelter_id,
        };
        const data = {
          created: counts.created ?? 0,
          started: counts.started ?? 0,
          completed: counts.completed ?? 0,
          returned: counts.returned ?? 0,
          cancelled: counts.cancelled ?? 0,
          violation: counts.violation ?? 0,
        };
        await tx.dailyCustody.upsert({
          where: { date_species_region_shelterId: where },
          create: { ...where, ...data },
          update: data,
        });
      }

      const disputeRows = await this.disputeRows(tx, from, to);
      for (const row of disputeRows) {
        const counts = this.counts(row);
        const where = {
          date: this.asDate(row.day),
          species: row.species,
          region: row.region,
          shelterId: row.shelter_id,
        };
        const data = {
          opened: counts.opened ?? 0,
          resolved: counts.resolved ?? 0,
        };
        await tx.dailyDispute.upsert({
          where: { date_species_region_shelterId: where },
          create: { ...where, ...data },
          update: data,
        });
      }

      const userRows = await this.userRows(tx, from, to);
      for (const row of userRows) {
        const counts = this.counts(row);
        const where = {
          date: this.asDate(row.day),
          region: row.region,
          shelterId: row.shelter_id,
        };
        const data = {
          registered: counts.registered ?? 0,
          suspended: counts.suspended ?? 0,
          reinstated: counts.reinstated ?? 0,
          deleted: counts.deleted ?? 0,
        };
        await tx.dailyUser.upsert({
          where: { date_region_shelterId: where },
          create: { ...where, ...data },
          update: data,
        });
      }

      const rowCount =
        adoptionRows.length +
        custodyRows.length +
        disputeRows.length +
        userRows.length;
      const processedThrough =
        to.getUTCFullYear() >= 9999 ? new Date() : to;

      await tx.analyticsProjectionState.upsert({
        where: { key: PROJECTION_KEY },
        create: {
          key: PROJECTION_KEY,
          lastProcessedAt: processedThrough,
          lastRunAt: new Date(),
          rowCount,
        },
        update: {
          lastProcessedAt: processedThrough,
          lastRunAt: new Date(),
          rowCount,
        },
      });

      return this.toProjectionState({
        key: PROJECTION_KEY,
        lastProcessedAt: processedThrough,
        lastRunAt: new Date(),
        rowCount,
      });
    });
  }

  async getState(): Promise<ProjectionState> {
    const state = await this.prisma.analyticsProjectionState.findUnique({
      where: { key: PROJECTION_KEY },
    });
    return this.toProjectionState(
      state ?? {
        key: PROJECTION_KEY,
        lastProcessedAt: null,
        lastRunAt: new Date(0),
        rowCount: 0,
      },
    );
  }

  private toProjectionState(state: {
    key: string;
    lastProcessedAt: Date | null;
    lastRunAt: Date;
    rowCount: number;
  }): ProjectionState {
    return {
      ...state,
      refreshLagSeconds: state.lastProcessedAt
        ? Math.max(
            0,
            Math.floor((Date.now() - state.lastProcessedAt.getTime()) / 1000),
          )
        : null,
      refreshIntervalSeconds: REFRESH_INTERVAL_MS / 1000,
    };
  }

  private asDate(value: Date | string): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  }

  private counts(row: AggregateRow): Counts {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (
        key === 'day' ||
        key === 'species' ||
        key === 'age_band' ||
        key === 'size' ||
        key === 'region' ||
        key === 'shelter_id'
      ) {
        continue;
      }
      result[key] = Number(value ?? 0);
    }
    return result as Counts;
  }

  private adoptionRows(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
    expiredCutoff: Date,
  ): Promise<AggregateRow[]> {
    return tx.$queryRaw<AggregateRow[]>(Prisma.sql`
      WITH enriched AS (
        SELECT
          (e.created_at AT TIME ZONE 'UTC')::date AS day,
          COALESCE(NULLIF(p.species::text, ''), 'UNKNOWN') AS species,
          CASE
            WHEN p.age IS NULL THEN 'UNKNOWN'
            WHEN p.age < 1 THEN 'UNDER_1'
            WHEN p.age < 4 THEN 'YOUNG'
            WHEN p.age < 10 THEN 'ADULT'
            ELSE 'SENIOR'
          END AS age_band,
          COALESCE(NULLIF(p.size::text, ''), 'UNKNOWN') AS size,
          COALESCE(NULLIF(LEFT(p.state, 120), ''), NULLIF(LEFT(p.country, 120), ''), 'UNKNOWN') AS region,
          COALESCE(NULLIF(p.current_owner_id, ''), 'UNKNOWN') AS shelter_id,
          e.event_type::text AS event_type,
          e.created_at AS created_at
        FROM event_logs e
        LEFT JOIN pets p ON p.id = e.payload->>'petId'
        WHERE e.created_at >= ${from}
          AND e.created_at < ${to}
          AND e.event_type::text IN (
            'ADOPTION_REQUESTED', 'ADOPTION_APPROVED', 'ADOPTION_ESCROW_FUNDED',
            'ADOPTION_COMPLETED', 'ADOPTION_REJECTED', 'ADOPTION_CANCELLED'
          )
      )
      SELECT
        day,
        species,
        region,
        shelter_id,
        COUNT(*) FILTER (WHERE event_type = 'ADOPTION_REQUESTED')::int AS requested,
        COUNT(*) FILTER (WHERE event_type = 'ADOPTION_APPROVED')::int AS approved,
        COUNT(*) FILTER (WHERE event_type = 'ADOPTION_ESCROW_FUNDED')::int AS funded,
        COUNT(*) FILTER (WHERE event_type = 'ADOPTION_COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE event_type = 'ADOPTION_REJECTED')::int AS rejected,
        COUNT(*) FILTER (WHERE event_type = 'ADOPTION_CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (
          WHERE event_type = 'ADOPTION_REQUESTED' AND created_at < ${expiredCutoff}
        )::int AS expired
        FROM enriched
        GROUP BY day, species, age_band, size, region, shelter_id
      `);
  }

  private custodyRows(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
  ): Promise<AggregateRow[]> {
    return tx.$queryRaw<AggregateRow[]>(Prisma.sql`
      WITH enriched AS (
        SELECT
          (e.created_at AT TIME ZONE 'UTC')::date AS day,
          COALESCE(NULLIF(p.species::text, ''), 'UNKNOWN') AS species,
          COALESCE(NULLIF(LEFT(p.state, 120), ''), NULLIF(LEFT(p.country, 120), ''), 'UNKNOWN') AS region,
          COALESCE(NULLIF(p.current_owner_id, ''), 'UNKNOWN') AS shelter_id,
          e.event_type::text AS event_type
        FROM event_logs e
        LEFT JOIN pets p ON p.id = e.payload->>'petId'
        WHERE e.created_at >= ${from}
          AND e.created_at < ${to}
          AND e.event_type::text IN (
            'CUSTODY_CREATED', 'CUSTODY_STARTED', 'CUSTODY_COMPLETED',
            'CUSTODY_RETURNED', 'CUSTODY_CANCELLED', 'CUSTODY_VIOLATION'
          )
      )
      SELECT
        day,
        species,
        region,
        shelter_id,
        COUNT(*) FILTER (WHERE event_type = 'CUSTODY_CREATED')::int AS created,
        COUNT(*) FILTER (WHERE event_type = 'CUSTODY_STARTED')::int AS started,
        COUNT(*) FILTER (WHERE event_type = 'CUSTODY_COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE event_type = 'CUSTODY_RETURNED')::int AS returned,
        COUNT(*) FILTER (WHERE event_type = 'CUSTODY_CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE event_type = 'CUSTODY_VIOLATION')::int AS violation
      FROM enriched
      GROUP BY day, species, region, shelter_id
    `);
  }

  private disputeRows(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
  ): Promise<AggregateRow[]> {
    return tx.$queryRaw<AggregateRow[]>(Prisma.sql`
      WITH enriched AS (
        SELECT
          (e.created_at AT TIME ZONE 'UTC')::date AS day,
          COALESCE(NULLIF(p.species::text, ''), 'UNKNOWN') AS species,
          COALESCE(NULLIF(LEFT(p.state, 120), ''), NULLIF(LEFT(p.country, 120), ''), 'UNKNOWN') AS region,
          COALESCE(NULLIF(e.payload->>'shelterId', ''), NULLIF(p.current_owner_id, ''), 'UNKNOWN') AS shelter_id,
          e.event_type::text AS event_type
        FROM event_logs e
        LEFT JOIN adoptions a ON a.id = e.payload->>'adoptionId'
        LEFT JOIN pets p ON p.id = a.pet_id
        WHERE e.created_at >= ${from}
          AND e.created_at < ${to}
          AND e.event_type::text IN ('DISPUTE_OPENED', 'DISPUTE_RESOLVED')
      )
      SELECT
        day,
        species,
        region,
        shelter_id,
        COUNT(*) FILTER (WHERE event_type = 'DISPUTE_OPENED')::int AS opened,
        COUNT(*) FILTER (WHERE event_type = 'DISPUTE_RESOLVED')::int AS resolved
      FROM enriched
      GROUP BY day, species, region, shelter_id
    `);
  }

  private userRows(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
  ): Promise<AggregateRow[]> {
    return tx.$queryRaw<AggregateRow[]>(Prisma.sql`
      WITH enriched AS (
        SELECT
          (e.created_at AT TIME ZONE 'UTC')::date AS day,
          COALESCE(NULLIF(LEFT(u.location, 120), ''), 'UNKNOWN') AS region,
          'UNKNOWN' AS shelter_id,
          e.event_type::text AS event_type
        FROM event_logs e
        LEFT JOIN users u ON u.id = COALESCE(e.payload->>'userId', e.entity_id)
        WHERE e.created_at >= ${from}
          AND e.created_at < ${to}
          AND e.event_type::text IN (
            'USER_REGISTERED', 'USER_SUSPENDED', 'USER_REINSTATED', 'USER_DELETED'
          )
      )
      SELECT
        day,
        region,
        shelter_id,
        COUNT(*) FILTER (WHERE event_type = 'USER_REGISTERED')::int AS registered,
        COUNT(*) FILTER (WHERE event_type = 'USER_SUSPENDED')::int AS suspended,
        COUNT(*) FILTER (WHERE event_type = 'USER_REINSTATED')::int AS reinstated,
        COUNT(*) FILTER (WHERE event_type = 'USER_DELETED')::int AS deleted
      FROM enriched
      GROUP BY day, region, shelter_id
    `);
  }
}
