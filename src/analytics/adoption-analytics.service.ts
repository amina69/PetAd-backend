import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import {
  AdoptionBreakdownDto,
  AdoptionFunnelDto,
  AdoptionSuccessDto,
  DropOffReasonDto,
  FunnelStageDto,
  StageMedianDto,
} from './dto/adoption-funnel.dto';

const SUCCESS_DEFINITION =
  'Completed and not returned or cancelled within 30 days';

interface FunnelRow {
  requested_raw: number;
  approved_count: number;
  funded_count: number;
  completed_count: number;
  rejected: number;
  cancelled: number;
  expired: number;
  requested_to_approved: number | null;
  approved_to_funded: number | null;
  funded_to_completed: number | null;
}

interface BreakdownRow {
  species: string;
  age_band: string;
  size: string;
  requested: number;
  completed: number;
}

interface SuccessRow {
  completed: number;
  successful: number;
}

@Injectable()
export class AdoptionAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFunnel(query: AnalyticsQueryDto = {}): Promise<AdoptionFunnelDto> {
    const windowDays = query.windowDays ?? 365;
    const expiredAfterDays = query.expiredAfterDays ?? 30;
    const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const fromDay = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    const expiredCutoff = new Date(
      Date.now() - expiredAfterDays * 24 * 60 * 60 * 1000,
    );

    const [funnelRows, breakdownRows, successRows] = await Promise.all([
      this.prisma.$queryRaw<FunnelRow[]>(Prisma.sql`
        WITH stage_events AS (
          SELECT
            e.entity_id AS adoption_id,
            MIN(e.created_at) FILTER (
              WHERE e.event_type::text = 'ADOPTION_REQUESTED'
            ) AS requested_at,
            MIN(e.created_at) FILTER (
              WHERE e.event_type::text = 'ADOPTION_APPROVED'
            ) AS approved_at,
            MIN(e.created_at) FILTER (
              WHERE e.event_type::text = 'ADOPTION_ESCROW_FUNDED'
            ) AS funded_at,
            MIN(e.created_at) FILTER (
              WHERE e.event_type::text = 'ADOPTION_COMPLETED'
            ) AS completed_at,
            MIN(e.created_at) FILTER (
              WHERE e.event_type::text = 'ADOPTION_REJECTED'
            ) AS rejected_at,
            MIN(e.created_at) FILTER (
              WHERE e.event_type::text = 'ADOPTION_CANCELLED'
            ) AS cancelled_at
          FROM event_logs e
          WHERE e.created_at >= ${from}
            AND e.event_type::text IN (
              'ADOPTION_REQUESTED', 'ADOPTION_APPROVED',
              'ADOPTION_ESCROW_FUNDED', 'ADOPTION_COMPLETED',
              'ADOPTION_REJECTED', 'ADOPTION_CANCELLED'
            )
          GROUP BY e.entity_id
        ),
        counts AS (
          SELECT
            COUNT(requested_at)::int AS requested_raw,
            LEAST(COUNT(approved_at)::int, COUNT(requested_at)::int) AS approved_count,
            LEAST(
              COUNT(funded_at)::int,
              COUNT(approved_at)::int,
              COUNT(requested_at)::int
            ) AS funded_count,
            LEAST(
              COUNT(completed_at)::int,
              COUNT(funded_at)::int,
              COUNT(approved_at)::int,
              COUNT(requested_at)::int
            ) AS completed_count,
            COUNT(rejected_at)::int AS rejected,
            COUNT(cancelled_at)::int AS cancelled,
            COUNT(*) FILTER (
              WHERE requested_at < ${expiredCutoff} AND completed_at IS NULL
            )::int AS expired
          FROM stage_events
        ),
        medians AS (
          SELECT
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (approved_at - requested_at))
            ) FILTER (WHERE requested_at IS NOT NULL AND approved_at IS NOT NULL)
              AS requested_to_approved,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (funded_at - approved_at))
            ) FILTER (WHERE approved_at IS NOT NULL AND funded_at IS NOT NULL)
              AS approved_to_funded,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (completed_at - funded_at))
            ) FILTER (WHERE funded_at IS NOT NULL AND completed_at IS NOT NULL)
              AS funded_to_completed
          FROM stage_events
        )
        SELECT * FROM counts, medians
      `),
      this.prisma.$queryRaw<BreakdownRow[]>(Prisma.sql`
        SELECT
          species,
          age_band,
          size,
          SUM(requested)::int AS requested,
          SUM(completed)::int AS completed
        FROM daily_adoptions
        WHERE date >= ${fromDay}
        GROUP BY species, age_band, size
        ORDER BY species, age_band, size
      `),
      this.prisma.$queryRaw<SuccessRow[]>(Prisma.sql`
        WITH completed AS (
          SELECT
            e.payload->>'petId' AS pet_id,
            e.created_at AS completed_at
          FROM event_logs e
          WHERE e.created_at >= ${from}
            AND e.event_type::text = 'ADOPTION_COMPLETED'
        )
        SELECT
          COUNT(*)::int AS completed,
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1
              FROM event_logs r
              WHERE r.event_type::text IN ('PET_RETURNED', 'CUSTODY_RETURNED')
                AND r.payload->>'petId' = c.pet_id
                AND r.created_at > c.completed_at
                AND r.created_at <= c.completed_at + INTERVAL '30 days'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM event_logs r
              WHERE r.event_type::text = 'ADOPTION_CANCELLED'
                AND r.payload->>'petId' = c.pet_id
                AND r.created_at > c.completed_at
                AND r.created_at <= c.completed_at + INTERVAL '30 days'
            )
          )::int AS successful
        FROM completed c
      `),
    ]);

    const funnel = funnelRows[0];
    const requested = Number(funnel?.requested_raw ?? 0);
    const approved = Math.min(Number(funnel?.approved_count ?? 0), requested);
    const funded = Math.min(Number(funnel?.funded_count ?? 0), approved);
    const completed = Math.min(Number(funnel?.completed_count ?? 0), funded);
    const rejected = Number(funnel?.rejected ?? 0);
    const cancelled = Number(funnel?.cancelled ?? 0);
    const expired = Number(funnel?.expired ?? 0);

    const rate = (count: number): number =>
      requested === 0 ? 0 : Math.round((count / requested) * 10_000) / 100;

    const stages: FunnelStageDto[] = [
      { stage: 'REQUESTED', count: requested, conversionRate: requested ? 100 : 0 },
      { stage: 'APPROVED', count: approved, conversionRate: rate(approved) },
      { stage: 'FUNDED', count: funded, conversionRate: rate(funded) },
      { stage: 'COMPLETED', count: completed, conversionRate: rate(completed) },
    ];

    const dropOffs: DropOffReasonDto[] = [
      { reason: 'REJECTED', count: rejected, rate: rate(rejected) },
      { reason: 'CANCELLED', count: cancelled, rate: rate(cancelled) },
      { reason: 'EXPIRED', count: expired, rate: rate(expired) },
    ];

    const medians: StageMedianDto[] = [
      {
        from: 'REQUESTED',
        to: 'APPROVED',
        medianDays: this.toDays(funnel?.requested_to_approved),
      },
      {
        from: 'APPROVED',
        to: 'FUNDED',
        medianDays: this.toDays(funnel?.approved_to_funded),
      },
      {
        from: 'FUNDED',
        to: 'COMPLETED',
        medianDays: this.toDays(funnel?.funded_to_completed),
      },
    ];

    const breakdown: AdoptionBreakdownDto[] = breakdownRows.map((row) => {
      const rowRequested = Number(row.requested ?? 0);
      const rowCompleted = Number(row.completed ?? 0);
      return {
        species: row.species,
        ageBand: row.age_band,
        size: row.size,
        requested: rowRequested,
        completed: rowCompleted,
        completionRate:
          rowRequested === 0
            ? 0
            : Math.round((rowCompleted / rowRequested) * 10_000) / 100,
      };
    });

    const success: AdoptionSuccessDto = {
      completed: Number(successRows?.[0]?.completed ?? 0),
      successful: Number(successRows?.[0]?.successful ?? 0),
      definition: SUCCESS_DEFINITION,
    };

    return {
      windowDays,
      successDefinition: SUCCESS_DEFINITION,
      stages,
      dropOffs,
      medians,
      breakdown,
      success,
    };
  }

  private toDays(seconds: number | null | undefined): number | null {
    if (seconds === null || seconds === undefined) return null;
    return Math.round((Number(seconds) / 86400) * 1000) / 1000;
  }
}
