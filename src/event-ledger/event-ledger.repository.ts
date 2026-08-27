import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Data access layer for the EventLedger.
 * Encapsulates all Prisma queries related to event ledger records.
 */
@Injectable()
export class EventLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the event with the highest sequence number for a given aggregate.
   */
  async findLatestByAggregate(aggregateId: string) {
    return (this.prisma.eventLog as any).findFirst({
      where: { entityId: aggregateId },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true },
    });
  }

  /**
   * Creates a new event log entry.
   */
  async create(data: {
    entityType: string;
    entityId: string;
    eventType: string;
    actorId?: string;
    txHash?: string;
    blockHeight?: number;
    payload: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
    sequenceNumber: number;
  }) {
    return (this.prisma.eventLog as any).create({ data });
  }

  /**
   * Returns all events for a given aggregate, ordered by sequence number.
   */
  async findAllByAggregate(aggregateId: string) {
    return (this.prisma.eventLog as any).findMany({
      where: { entityId: aggregateId },
      orderBy: { sequenceNumber: 'asc' },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        eventType: true,
        actorId: true,
        payload: true,
        sequenceNumber: true,
        createdAt: true,
      },
    });
  }

  /**
   * Returns all events for a given aggregate type.
   */
  async findAllByAggregateType(aggregateType: string) {
    return (this.prisma.eventLog as any).findMany({
      where: { entityType: aggregateType },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        eventType: true,
        actorId: true,
        payload: true,
        sequenceNumber: true,
        createdAt: true,
      },
    });
  }

  /**
   * Returns all events matching a given event type.
   */
  async findAllByEventType(eventType: string) {
    return (this.prisma.eventLog as any).findMany({
      where: { eventType },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        eventType: true,
        actorId: true,
        payload: true,
        sequenceNumber: true,
        createdAt: true,
      },
    });
  }

  /**
   * Returns all missing sequence numbers for an aggregate.
   */
  async findGaps(aggregateId: string): Promise<number[]> {
    const events = await (this.prisma.eventLog as any).findMany({
      where: { entityId: aggregateId },
      orderBy: { sequenceNumber: 'asc' },
      select: { sequenceNumber: true },
    });

    const sequences = events
      .map((e: { sequenceNumber?: unknown }) => e.sequenceNumber)
      .filter(
        (s: unknown): s is number =>
          Number.isInteger(s) && (s as number) > 0,
      );

    const highest = sequences.length > 0 ? Math.max(...sequences) : 0;
    const present = new Set(sequences);
    const gaps: number[] = [];

    for (let i = 1; i <= highest; i++) {
      if (!present.has(i)) gaps.push(i);
    }

    return gaps;
  }
}
