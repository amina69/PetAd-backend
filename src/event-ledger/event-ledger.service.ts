import { Injectable, Logger } from '@nestjs/common';
import { EventEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventLedgerRepository } from './event-ledger.repository';

export interface AppendEventParams {
  aggregateType: EventEntityType | string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorId?: string;
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
   * This is a best-effort operation — failure is logged but does not
   * prevent the event from being written.
   */
  private async queueAnchoringJob(event: {
    id: string;
    entityType: string;
    entityId: string;
    eventType: string;
    sequenceNumber: number;
  }): Promise<void> {
    this.logger.log(
      `Queuing anchoring job for event ${event.id} (aggregate: ${event.entityType}/${event.entityId}, seq: ${event.sequenceNumber})`,
    );
    // Anchoring job implementation is deferred to issue #P3-27.
    // For now we log the intent. When the anchoring processor is ready,
    // this method will dispatch to the appropriate queue.
  }
}
