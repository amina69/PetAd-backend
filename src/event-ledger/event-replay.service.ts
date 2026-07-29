import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType, Prisma } from '@prisma/client';

export interface EventLedgerEntry {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId?: string | null;
  txHash?: string | null;
  blockHeight?: number | null;
  payload: Prisma.JsonValue;
  metadata?: Prisma.JsonValue | null;
  sequenceNumber?: number;
  createdAt: Date;
}

export interface ReplayOptions {
  /**
   * Replay only up to (and including) this sequence number.
   * Allows "time travel" to a specific point in history.
   */
  upToSequence?: number;
  /**
   * When true, computes the resulting state without writing to the database.
   */
  dryRun?: boolean;
}

export interface ReplayResult {
  aggregateId: string;
  entityType: string;
  eventsProcessed: number;
  totalEvents: number;
  replayedUpToSequence: number | null;
  dryRun: boolean;
  finalState: Record<string, unknown>;
}

@Injectable()
export class EventReplayService {
  private readonly logger = new Logger(EventReplayService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replays events for a given aggregate to reconstruct its state.
   *
   * Reads events from the EventLog in sequence order and applies them
   * to build the current (or historical) state of the aggregate.
   *
   * @param aggregateId - The ID of the aggregate (entity) to replay
   * @param entityType - The type of entity (PET, ADOPTION, CUSTODY, etc.)
   * @param options - Optional replay configuration
   * @returns ReplayResult containing the final state and metadata
   */
  async replayAggregate(
    aggregateId: string,
    entityType: EventEntityType,
    options: ReplayOptions = {},
  ): Promise<ReplayResult> {
    const { upToSequence, dryRun = false } = options;

    // Fetch all events for the aggregate, ordered by sequenceNumber (or createdAt)
    const allEvents = await this.prisma.eventLog.findMany({
      where: {
        entityType,
        entityId: aggregateId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Filter events up to the specified sequence number if provided.
    // Since the EventLog model doesn't yet have a dedicated sequenceNumber
    // column, we use 1-based positional indexing for now.
    const eventsToReplay =
      upToSequence != null
        ? allEvents.slice(0, upToSequence)
        : allEvents;

    // Build the final state by reducing all events
    const initialState: Record<string, unknown> = {};
    const finalState = eventsToReplay.reduce<Record<string, unknown>>(
      (state, event) => {
        const payload =
          event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
            ? (event.payload as Record<string, unknown>)
            : {};
        return { ...state, ...payload, lastEventType: event.eventType };
      },
      initialState,
    );

    const result: ReplayResult = {
      aggregateId,
      entityType,
      eventsProcessed: eventsToReplay.length,
      totalEvents: allEvents.length,
      replayedUpToSequence: upToSequence ?? null,
      dryRun,
      finalState,
    };

    this.logger.log(
      `Replayed aggregate ${entityType}:${aggregateId} — ` +
        `${result.eventsProcessed}/${result.totalEvents} events` +
        (dryRun ? ' (dry run)' : '') +
        (upToSequence ? ` up to sequence #${upToSequence}` : ''),
    );

    return result;
  }
}
