import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AdoptionStatus,
  CustodyStatus,
  EscrowStatus,
  EventEntityType,
  EventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { EventReplayResponseDto } from '../dto/event-replay-response.dto';
import { createStrictReadOnlyPrisma } from './strict-prisma.proxy';

/**
 * Options accepted by EventReplayService.replayAggregate.
 */
export interface ReplayAggregateOptions {
  aggregateId: string;
  /** Optional hint for the aggregate type. If absent, auto-detected from events. */
  aggregateType?: EventEntityType;
  /** Defaults to true for safety. When false, applies corrected state to the DB. */
  dryRun?: boolean;
  /** Required when dryRun is false to confirm the write. */
  confirm?: boolean;
  /** Required audit reason when dryRun is false. */
  reason?: string;
  /** Only replay the first N events (index-based, ordered by createdAt ASC). */
  upToSequence?: number;
  /**
   * Admin user ID for audit logging. The controller guarantees a non-null
   * value via its runtime `if (!actorId)` guard; optional here so unit
   * tests can omit it without faking an admin identity.
   */
  actorId?: string;
}

/**
 * Aggregate types whose reducer is read-only — live apply is never
 * meaningful because there's no persistent field to mutate.
 * (Currently PET_REGISTERED only confirms pet existence.)
 */
const READ_ONLY_AGGREGATES: ReadonlySet<EventEntityType> = new Set([
  EventEntityType.PET,
]);

// ─── Reducers ────────────────────────────────────────────────────────────

type Reducer<S> = (
  state: S,
  event: { eventType: EventType; payload: Prisma.JsonValue },
) => S;

const adoptionReducer: Reducer<{ status?: AdoptionStatus }> = (state, e) => {
  switch (e.eventType) {
    case EventType.ADOPTION_REQUESTED:
      return { ...state, status: AdoptionStatus.REQUESTED };
    case EventType.ADOPTION_APPROVED:
      return { ...state, status: AdoptionStatus.APPROVED };
    case EventType.ADOPTION_COMPLETED:
      return { ...state, status: AdoptionStatus.COMPLETED };
    default:
      return state;
  }
};

const custodyReducer: Reducer<{ status?: CustodyStatus }> = (state, e) => {
  switch (e.eventType) {
    case EventType.CUSTODY_STARTED:
      return { ...state, status: CustodyStatus.PENDING };
    case EventType.CUSTODY_RETURNED:
      return { ...state, status: CustodyStatus.RETURNED };
    case EventType.CUSTODY_VIOLATION:
      return { ...state, status: CustodyStatus.VIOLATION };
    case EventType.CUSTODY_CANCELLED:
      return { ...state, status: CustodyStatus.CANCELLED };
    default:
      return state;
  }
};

const escrowReducer: Reducer<{ status?: EscrowStatus }> = (state, e) => {
  switch (e.eventType) {
    case EventType.ESCROW_CREATED:
      return { ...state, status: EscrowStatus.CREATED };
    case EventType.ESCROW_FUNDED:
      return { ...state, status: EscrowStatus.FUNDED };
    case EventType.ESCROW_RELEASED:
      return { ...state, status: EscrowStatus.RELEASED };
    case EventType.ESCROW_REFUNDED:
      return { ...state, status: EscrowStatus.REFUNDED };
    default:
      return state;
  }
};

/**
 * User reducer — tolerates both absolute and delta-style trust updates.
 *
 * The starting baseline is supplied by the caller (current DB trustScore),
 * so a delta-only event stream doesn't reset a user to 0.
 */
const userReducer: Reducer<{ trustScore?: number }> = (state, e) => {
  if (e.eventType !== EventType.TRUST_SCORE_UPDATED) {
    return state;
  }
  const payload = (e.payload ?? {}) as { trustScore?: number; delta?: number };
  if (typeof payload.trustScore === 'number') {
    return { ...state, trustScore: payload.trustScore };
  }
  if (
    typeof payload.delta === 'number' &&
    typeof state.trustScore === 'number'
  ) {
    return { ...state, trustScore: state.trustScore + payload.delta };
  }
  // No baseline yet — return state unchanged; a discrepancy will surface
  // during diff so an admin can investigate before applying.
  return state;
};

/**
 * PET reducer — registers PET_REGISTERED as confirming pet presence.
 * The diff checks whether `registered` is consistent with the current DB.
 */
const petReducer: Reducer<{ registered?: boolean }> = (state, e) => {
  if (e.eventType === EventType.PET_REGISTERED) {
    return { ...state, registered: true };
  }
  return state;
};

const REDUCER_BY_ENTITY: Partial<
  Record<EventEntityType, (state: any, e: any) => any>
> = {
  [EventEntityType.ADOPTION]: adoptionReducer,
  [EventEntityType.CUSTODY]: custodyReducer,
  [EventEntityType.ESCROW]: escrowReducer,
  [EventEntityType.USER]: userReducer,
  [EventEntityType.PET]: petReducer,
};

/**
 * Service that replays an aggregate's event log to reconstruct its
 * state, compares against the current DB state, and (optionally)
 * applies corrections.
 *
 * Dry-run behavior:
 *   - `dryRun: true` (default) wraps PrismaService in a recursive
 *     write-blocking Proxy. Any write attempted at any depth throws.
 *   - `dryRun: false` writes corrected state inside a transaction
 *     alongside the audit log entry, so either both commit or both
 *     roll back.
 */
@Injectable()
export class EventReplayService {
  private readonly logger = new Logger(EventReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Replay events for an aggregate and return the reconstructed state
   * alongside any discrepancies vs the current DB state.
   *
   * @throws NotFoundException when no events exist for the aggregate.
   */
  async replayAggregate(
    options: ReplayAggregateOptions & { actorId?: string },
  ): Promise<EventReplayResponseDto> {
    const dryRun = options.dryRun ?? true;
    const { aggregateId } = options;

    // For dry runs wrap Prisma in a recursive write-blocking Proxy so
    // any attempted write — at any depth — surfaces immediately. Live
    // runs use the real client.
    const prisma = dryRun
      ? createStrictReadOnlyPrisma(this.prisma)
      : this.prisma;

    // 1) Auto-detect aggregate type from a single event lookup.
    const firstEvent = await prisma.eventLog.findFirst({
      where: { entityId: aggregateId },
      orderBy: { createdAt: 'asc' },
      select: { entityType: true, entityId: true },
    });

    const aggregateType = options.aggregateType ?? firstEvent?.entityType;
    if (!aggregateType) {
      throw new NotFoundException(
        `No events found for aggregateId "${aggregateId}" — cannot determine aggregate type.`,
      );
    }

    const reducer = REDUCER_BY_ENTITY[aggregateType];
    if (!reducer) {
      // Defensive: every EventEntityType has a reducer in the map above.
      throw new NotFoundException(
        `No replay reducer registered for aggregateType "${aggregateType}".`,
      );
    }

    // 2) Fetch the (optionally truncated) event stream.
    const events = await prisma.eventLog.findMany({
      where: { entityId: aggregateId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, eventType: true, payload: true, createdAt: true },
    });

    const slicedEvents =
      typeof options.upToSequence === 'number'
        ? events.slice(0, options.upToSequence)
        : events;

    // 3) Fetch the current DB state up-front so we can use it as the
    //    reducer's initial baseline (critical for user deltas) and as
    //    the source of truth for the diff.
    const currentState = await this.fetchCurrentState(
      prisma,
      aggregateId,
      aggregateType,
    );

    // 4) Replay: fold events into a typed state, seeded with DB baseline.
    const replayedState = slicedEvents.reduce<Record<string, unknown>>(
      (state, event) => reducer(state, event),
      this.initialStateFor(aggregateType, currentState),
    );

    // 5) Compute discrepancies across fields the reducer tracks.
    const discrepancies = this.diff(replayedState, currentState);

    // 6) Decide whether to apply corrections. If the target row is
    //    missing we MUST NOT attempt an update — that would throw.
    //    PET has no writable reducer fields, so live apply for PET
    //    would silently no-op; gate explicitly to avoid reporting
    //    `appliedToDb: true` when nothing was actually written.
    const recordMissing = Object.keys(currentState).length === 0;
    const hasWritableReducer = !READ_ONLY_AGGREGATES.has(aggregateType);
    const canApply =
      !dryRun &&
      Boolean(options.confirm) &&
      hasWritableReducer &&
      !recordMissing &&
      Object.keys(replayedState).length > 0 &&
      discrepancies.length > 0;

    let appliedToDb = false;
    if (canApply) {
      await prisma.$transaction(async (tx) => {
        await this.applyCorrectedState(
          tx,
          aggregateType,
          aggregateId,
          replayedState,
        );
        // Write the audit row in the SAME transaction so audit and
        // DB write either both succeed or both roll back.
        await this.writeAudit(tx, {
          aggregateId,
          aggregateType,
          eventsProcessed: slicedEvents.length,
          discrepancies,
          dryRun,
          appliedToDb: true,
          actorId: options.actorId,
          reason: options.reason,
        });
      });
      appliedToDb = true;
    } else {
      // Dry-run / read-only-aggregate / missing-record audit goes
      // through the regular service. Surface failures so silent
      // audit gaps are visible instead of being swallowed.
      const auditResult = await this.loggingService.log({
        level: dryRun ? 'INFO' : 'WARN',
        action: dryRun
          ? 'ADMIN_REPLAY_DRY_RUN'
          : READ_ONLY_AGGREGATES.has(aggregateType)
            ? 'ADMIN_REPLAY_READONLY'
            : 'ADMIN_REPLAY_NOOP',
        message: dryRun
          ? `Admin dry-run replay for ${aggregateType} ${aggregateId} — ${discrepancies.length} discrepancies`
          : `Admin live replay for ${aggregateType} ${aggregateId} was a no-op (recordMissing=${recordMissing}, hasWritableReducer=${hasWritableReducer})`,
        userId: options.actorId,
        metadata: {
          aggregateId,
          aggregateType,
          eventsProcessed: slicedEvents.length,
          discrepancies,
          dryRun,
          appliedToDb: false,
          recordMissing,
          hasWritableReducer,
        },
      });
      if (auditResult === null) {
        this.logger.warn(
          `Replay audit write failed (admin=${options.actorId}, aggregate=${aggregateType}/${aggregateId}) — ` +
            'replay result returned but no audit row was recorded.',
        );
      }
    }

    return {
      aggregateId,
      aggregateType,
      eventsProcessed: slicedEvents.length,
      replayedState,
      discrepancies,
      appliedToDb,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  /**
   * Provide the reducer with the current DB state so delta events
   * apply on top of the correct baseline instead of 0.
   */
  private initialStateFor(
    aggregateType: EventEntityType,
    currentState: Record<string, unknown>,
  ): Record<string, unknown> {
    if (aggregateType === EventEntityType.USER) {
      return {
        trustScore:
          typeof currentState.trustScore === 'number'
            ? currentState.trustScore
            : 0,
      };
    }
    return {};
  }

  private async fetchCurrentState(
    prisma: PrismaService,
    aggregateId: string,
    aggregateType: EventEntityType,
  ): Promise<Record<string, unknown>> {
    switch (aggregateType) {
      case EventEntityType.ADOPTION: {
        const a = await prisma.adoption.findUnique({
          where: { id: aggregateId },
          select: { status: true },
        });
        return a ? { status: a.status } : {};
      }
      case EventEntityType.CUSTODY: {
        const c = await prisma.custody.findUnique({
          where: { id: aggregateId },
          select: { status: true },
        });
        return c ? { status: c.status } : {};
      }
      case EventEntityType.ESCROW: {
        const e = await prisma.escrow.findUnique({
          where: { id: aggregateId },
          select: { status: true },
        });
        return e ? { status: e.status } : {};
      }
      case EventEntityType.USER: {
        const u = await prisma.user.findUnique({
          where: { id: aggregateId },
          select: { trustScore: true },
        });
        return u ? { trustScore: u.trustScore } : {};
      }
      case EventEntityType.PET: {
        const p = await prisma.pet.findUnique({
          where: { id: aggregateId },
          select: { id: true },
        });
        return p ? { registered: true } : { registered: false };
      }
      default:
        return {};
    }
  }

  private async applyCorrectedState(
    tx: Prisma.TransactionClient,
    aggregateType: EventEntityType,
    aggregateId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    switch (aggregateType) {
      case EventEntityType.ADOPTION: {
        if (state.status) {
          await tx.adoption.update({
            where: { id: aggregateId },
            data: { status: state.status as AdoptionStatus },
          });
        }
        return;
      }
      case EventEntityType.CUSTODY: {
        if (state.status) {
          await tx.custody.update({
            where: { id: aggregateId },
            data: { status: state.status as CustodyStatus },
          });
        }
        return;
      }
      case EventEntityType.ESCROW: {
        if (state.status) {
          await tx.escrow.update({
            where: { id: aggregateId },
            data: { status: state.status as EscrowStatus },
          });
        }
        return;
      }
      case EventEntityType.USER: {
        if (typeof state.trustScore === 'number') {
          await tx.user.update({
            where: { id: aggregateId },
            data: { trustScore: state.trustScore },
          });
        }
        return;
      }
      case EventEntityType.PET: {
        // PET_REGISTERED implies the pet exists; nothing to mutate.
        return;
      }
      default:
        return;
    }
  }

  /**
   * Diff replayed vs current state and produce a list of
   * human-readable discrepancy strings formatted as
   * `"field: replayed=X, current=Y"`.
   */
  private diff(
    replayed: Record<string, unknown>,
    current: Record<string, unknown>,
  ): string[] {
    const discrepancies: string[] = [];
    for (const key of Object.keys(replayed)) {
      const replayedVal = replayed[key];
      const currentVal = current[key];
      const same =
        replayedVal === currentVal ||
        (typeof replayedVal === 'number' &&
          typeof currentVal === 'number' &&
          Math.abs(replayedVal - currentVal) < 1e-9);
      if (!same) {
        discrepancies.push(
          `${key}: replayed=${String(replayedVal)}, current=${String(currentVal)}`,
        );
      }
    }
    return discrepancies;
  }

  /**
   * Writes the audit row directly inside the active transaction so it
   * has the same atomicity guarantees as the DB updates.
   */
  private async writeAudit(
    tx: Prisma.TransactionClient,
    entry: {
      aggregateId: string;
      aggregateType: string;
      eventsProcessed: number;
      discrepancies: string[];
      dryRun: boolean;
      appliedToDb: boolean;
      actorId?: string;
      reason?: string;
    },
  ): Promise<void> {
    await tx.appLog.create({
      data: {
        level: entry.appliedToDb ? 'WARN' : 'INFO',
        action: entry.appliedToDb
          ? 'REPLAY_APPLIED'
          : 'ADMIN_REPLAY_DRY_RUN',
        message: entry.appliedToDb
          ? `Admin applied replay for ${entry.aggregateType} ${entry.aggregateId} — ${entry.discrepancies.length} discrepancies fixed`
          : `Admin dry-run replay for ${entry.aggregateType} ${entry.aggregateId} — ${entry.discrepancies.length} discrepancies`,
        userId: entry.actorId ?? null,
        metadata: {
          aggregateId: entry.aggregateId,
          aggregateType: entry.aggregateType,
          eventsProcessed: entry.eventsProcessed,
          discrepancies: entry.discrepancies,
          dryRun: entry.dryRun,
          appliedToDb: entry.appliedToDb,
          reason: entry.reason,
        },
      },
    });
  }
}
