import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventLedgerRepository } from './event-ledger.repository';
import { AnchoringQueueService } from '../jobs/services/anchoring-queue.service';
import { Optional, Inject, forwardRef } from '@nestjs/common';
import { EventBusService } from '../events/event-bus.service';

export interface AppendEventParams {
  aggregateType: EventEntityType | string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorId?: string;
}

export interface EventLedgerQuery {
  aggregateType?: string;
  aggregateId?: string;
  eventType?: string;
  actorId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string | number;
}

/**
 * Core write service for the event ledger.
 *
 * Every part of the system that creates events calls appendEvent().
 * Sequence numbers are allocated inside a DB transaction to prevent
 * race conditions when multiple writers target the same aggregate.
 *
 * After a successful write an anchoring job is queued for later
 * blockchain anchoring (see issue #P3-27).
 */
@Injectable()
export class EventLedgerService {
  private readonly logger = new Logger(EventLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: EventLedgerRepository,
private readonly eventBus: EventBusService,
    @Optional()
    @Inject(forwardRef(() => AnchoringQueueService))
    private readonly anchoringQueueService?: AnchoringQueueService,
  ) {}

  /**
   * Appends an event to the ledger with a correctly sequenced sequence number.
   *
   * The aggregate is protected by a PostgreSQL advisory lock so concurrent
   * writers for the same aggregate serialize while writers for different
   * aggregates remain independent.
   *
   * After successful write, an anchoring job is queued.
   */
  async appendEvent(params: AppendEventParams) {
    return this.prisma.$transaction(async (tx) => {
      // Advisory lock prevents concurrent writes for the same aggregate
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${params.aggregateId}))
      `;

      const eventLog = tx.eventLog as any;

      // Fetch the current max sequence number for this aggregate
      const latestEvent = await eventLog.findFirst({
        where: { entityId: params.aggregateId },
        orderBy: { sequenceNumber: 'desc' },
        select: { sequenceNumber: true },
      });

      const sequenceNumber = (latestEvent?.sequenceNumber ?? 0) + 1;

      // Create the event with the allocated sequence number
      const event = await eventLog.create({
        data: {
          entityType: params.aggregateType,
          entityId: params.aggregateId,
          eventType: params.eventType,
          actorId: params.actorId,
          payload: params.payload as Prisma.InputJsonValue,
          sequenceNumber,
        },
      });

      this.logger.log(
        `Event appended: ${params.eventType} on ${params.aggregateType} [${params.aggregateId}] seq=${sequenceNumber}`,
      );

      // Queue anchoring job (best-effort, non-blocking)
      try {
        await this.queueAnchoringJob(event);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to queue anchoring job for event ${event.id}: ${reason}`,
        );
      }

      // Publish through outbox to internal consumers (notifications, projections, anchoring, trust)
      try {
        await this.eventBus.publish({
          eventId: event.id,
          aggregateId: params.aggregateId,
          globalPosition: sequenceNumber,
          eventType: params.eventType,
          payload: params.payload,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to publish event ${event.id} to event bus: ${reason}`,
        );
      }

      return event;
    });
  }

  /**
   * Returns all events for a given aggregate, ordered by sequence number.
   */
  async getAggregateEvents(aggregateId: string) {
    return this.repository.findAllByAggregate(aggregateId);
  }

  /**
   * Returns a bounded page of events filtered by ledger attributes.
   */
  async getLedgerEvents(query: EventLedgerQuery) {
    const requestedLimit =
      query.limit === undefined || query.limit === '' ? 50 : Number(query.limit);
    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 200
    ) {
      throw new BadRequestException('limit must be an integer between 1 and 200');
    }

    let afterPosition: number | undefined;
    if (query.cursor !== undefined && query.cursor !== '') {
      afterPosition = Number(query.cursor);
      if (!Number.isSafeInteger(afterPosition) || afterPosition < 0) {
        throw new BadRequestException('cursor must be a non-negative global position');
      }
    }

    const where: Record<string, unknown> = {};
    if (query.aggregateType) where.entityType = query.aggregateType;
    if (query.aggregateId) where.entityId = query.aggregateId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.actorId) where.actorId = query.actorId;

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) {
        const from = new Date(query.from);
        if (Number.isNaN(from.getTime())) {
          throw new BadRequestException('from must be a valid date-time');
        }
        createdAt.gte = from;
      }
      if (query.to) {
        const to = new Date(query.to);
        if (Number.isNaN(to.getTime())) {
          throw new BadRequestException('to must be a valid date-time');
        }
        createdAt.lte = to;
      }
      if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
        throw new BadRequestException('from must not be later than to');
      }
      where.createdAt = createdAt;
    }

    const events = await this.repository.findPage(
      where,
      afterPosition,
      requestedLimit + 1,
    );
    const hasMore = events.length > requestedLimit;
    const data = hasMore ? events.slice(0, requestedLimit) : events;
    const lastEvent = data[data.length - 1];

    return {
      data,
      limit: requestedLimit,
      hasMore,
      nextCursor:
        hasMore && lastEvent?.globalPosition !== undefined
          ? String(lastEvent.globalPosition)
          : null,
    };
  }

  /**
   * Returns all missing sequence numbers for an aggregate.
   */
  async detectGaps(aggregateId: string): Promise<number[]> {
    return this.repository.findGaps(aggregateId);
  }

  /**
   * Returns events filtered by aggregate type.
   */
  async getEventsByAggregateType(aggregateType: string) {
    return this.repository.findAllByAggregateType(aggregateType);
  }

  /**
   * Returns events filtered by event type.
   */
  async getEventsByEventType(eventType: string) {
    return this.repository.findAllByEventType(eventType);
  }

  /**
   * Queues an anchoring job for later blockchain anchoring.
   */
  private async queueAnchoringJob(event: any): Promise<void> {
    await this.anchoringQueueService?.enqueueAnchoringJob(event);
  }
}
