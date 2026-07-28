import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export enum AggregateType {
  ADOPTION = 'ADOPTION',
  CUSTODY = 'CUSTODY',
  PET = 'PET',
  USER = 'USER',
}

export interface EventLedger {
  id?: string;
  aggregateType: AggregateType | string;
  aggregateId: string;
  sequenceNumber: number;
  eventType: string;
  payload: Record<string, unknown>;
  recordedBy?: string | null;
  recordedAt?: Date;
  [key: string]: unknown;
}

export interface AppendEventParams {
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  recordedBy?: string;
}

export interface AnchoringQueue {
  add(
    jobName: string,
    data: {
      eventId?: string;
      aggregateType: AggregateType | string;
      aggregateId: string;
      sequenceNumber: number;
    },
  ): Promise<unknown>;
}

export const ANCHORING_QUEUE = 'EVENT_LEDGER_ANCHORING_QUEUE';
export const ANCHOR_EVENT_JOB = 'ANCHOR_EVENT';

@Injectable()
export class EventLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ANCHORING_QUEUE)
    private readonly anchoringQueue: AnchoringQueue,
  ) {}

  async appendEvent(params: AppendEventParams): Promise<EventLedger> {
    const event = (await this.prisma.$transaction(async (transaction) => {
      const tx = transaction as any;
      const aggregateLockKey = `${params.aggregateType}:${params.aggregateId}`;

      if (typeof tx.$executeRaw !== 'function') {
        throw new Error(
          'The database transaction client must support advisory locks for event sequence allocation',
        );
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${aggregateLockKey}, 0))`,
      );

      const latestEvent = await tx.eventLedger.findFirst({
        where: {
          aggregateType: params.aggregateType,
          aggregateId: params.aggregateId,
        },
        orderBy: {
          sequenceNumber: 'desc',
        },
      });

      const sequenceNumber = (latestEvent?.sequenceNumber ?? 0) + 1;

      return tx.eventLedger.create({
        data: {
          aggregateType: params.aggregateType,
          aggregateId: params.aggregateId,
          sequenceNumber,
          eventType: params.eventType,
          payload: params.payload as Prisma.InputJsonValue,
          recordedBy: params.recordedBy,
        },
      });
    })) as unknown as EventLedger;

    await this.anchoringQueue.add(ANCHOR_EVENT_JOB, {
      eventId: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      sequenceNumber: event.sequenceNumber,
    });

    return event;
  }
}
