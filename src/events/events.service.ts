import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventType, EventEntityType, Prisma } from '@prisma/client';
import { DailyAggregatesProjectionService } from '../analytics/projections/daily-aggregates.projection';

export interface CreateEventLogDto {
  entityType: EventEntityType;
  entityId: string;
  eventType: EventType;
  actorId?: string;
  txHash?: string;
  blockHeight?: number;
  payload: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

export interface AppendEventDto {
  aggregateType: EventEntityType | string;
  aggregateId: string;
  eventType: EventType | string;
  actorId?: string;
  payload: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

export interface EventLedger {
  entityType: EventEntityType | string;
  entityId: string;
  eventType: EventType | string;
  payload: Prisma.JsonValue;
  sequenceNumber?: number;
  [key: string]: unknown;
}

export type AggregateState = Record<string, unknown>;

type JsonObject = Record<string, unknown>;

function asObject(value: Prisma.JsonValue): JsonObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function reduceLifecycleState(
  state: AggregateState,
  event: EventLedger,
  statusByEvent: Record<string, string>,
): AggregateState {
  const payload = asObject(event.payload);
  const status = statusByEvent[String(event.eventType)];

  return {
    ...state,
    ...payload,
    ...(status ? { status } : {}),
  };
}

export function adoptionReducer(
  state: AggregateState,
  event: EventLedger,
): AggregateState {
  return reduceLifecycleState(state, event, {
    ADOPTION_REQUESTED: 'PENDING',
    ADOPTION_APPROVED: 'APPROVED',
    ADOPTION_REJECTED: 'REJECTED',
    ADOPTION_COMPLETED: 'COMPLETED',
    ADOPTION_CANCELLED: 'CANCELLED',
  });
}

export function petReducer(
  state: AggregateState,
  event: EventLedger,
): AggregateState {
  return reduceLifecycleState(state, event, {
    PET_CREATED: 'AVAILABLE',
    PET_STATUS_CHANGED: String(asObject(event.payload).status ?? ''),
    PET_ADOPTED: 'ADOPTED',
    PET_RETURNED: 'AVAILABLE',
  });
}

export function custodyReducer(
  state: AggregateState,
  event: EventLedger,
): AggregateState {
  return reduceLifecycleState(state, event, {
    CUSTODY_REQUESTED: 'PENDING',
    CUSTODY_APPROVED: 'APPROVED',
    CUSTODY_STARTED: 'ACTIVE',
    CUSTODY_COMPLETED: 'COMPLETED',
    CUSTODY_CANCELLED: 'CANCELLED',
  });
}

export function escrowReducer(
  state: AggregateState,
  event: EventLedger,
): AggregateState {
  return reduceLifecycleState(state, event, {
    ESCROW_CREATED: 'CREATED',
    ESCROW_FUNDED: 'FUNDED',
    ESCROW_RELEASED: 'RELEASED',
    ESCROW_REFUNDED: 'REFUNDED',
    ESCROW_CANCELLED: 'CANCELLED',
  });
}

export function userReducer(
  state: AggregateState,
  event: EventLedger,
): AggregateState {
  return reduceLifecycleState(state, event, {
    USER_REGISTERED: 'ACTIVE',
    USER_ACTIVATED: 'ACTIVE',
    USER_DEACTIVATED: 'INACTIVE',
    USER_SUSPENDED: 'SUSPENDED',
    USER_REINSTATED: 'ACTIVE',
  });
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly projections?: DailyAggregatesProjectionService,
  ) {}

  async logEvent(dto: CreateEventLogDto) {
    try {
      const event = await this.prisma.eventLog.create({
        data: {
          entityType: dto.entityType,
          entityId: dto.entityId,
          eventType: dto.eventType,
          actorId: dto.actorId,
          txHash: dto.txHash,
          blockHeight: dto.blockHeight,
          payload: dto.payload,
          metadata: dto.metadata,
        },
      });

      this.logger.log(
        `Event logged: ${event.eventType} on ${event.entityType} [${event.entityId}]`,
      );

      if (this.projections) {
        try {
          await this.projections.refreshSince(event.createdAt);
        } catch (error) {
          this.logger.warn(
            `Daily aggregate refresh failed for ${event.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return event;
    } catch (error) {
      this.logger.error(
        `Failed to log event ${dto.eventType}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async appendEvent(dto: AppendEventDto) {
    const aggregateType = dto.aggregateType as EventEntityType;
    const eventType = dto.eventType as EventType;
    const payload = dto.payload as unknown as Record<string, unknown>;

    return this.prisma.$transaction(async (transaction) => {
      if (
        String(dto.aggregateType).toUpperCase() === 'ADOPTION' &&
        String(dto.eventType).toUpperCase() === 'ADOPTION_REQUESTED'
      ) {
        const petId = payload.petId;
        if (typeof petId !== 'string' || petId.length === 0) {
          throw new Error(
            'ADOPTION_REQUESTED events require a petId in their payload',
          );
        }
      }

      const event = await transaction.eventLog.create({
        data: {
          entityType: aggregateType,
          entityId: dto.aggregateId,
          eventType,
          actorId: dto.actorId,
          payload: dto.payload,
          metadata: dto.metadata,
        },
      });

      if (
        String(dto.aggregateType).toUpperCase() === 'ADOPTION' &&
        String(dto.eventType).toUpperCase() === 'ADOPTION_REQUESTED'
      ) {
        await transaction.eventLog.create({
          data: {
            entityType: EventEntityType.PET,
            entityId: payload.petId as string,
            eventType: 'PET_ADOPTION_REQUESTED' as EventType,
            actorId: dto.actorId,
            payload: dto.payload,
            metadata: dto.metadata,
          },
        });
      }

      return event;
    });
  }

  async replayAggregate<T extends AggregateState>(
    entityType: EventEntityType,
    entityId: string,
    initialState = {} as T,
  ): Promise<T> {
    const events = (await this.prisma.eventLog.findMany({
      where: {
        entityType,
        entityId,
      },
      orderBy: {
        sequenceNumber: 'asc',
      } as never,
    })) as unknown as EventLedger[];

    const reducer = this.getReducer(entityType);
    return events.reduce<AggregateState>(
      (state, event) => reducer(state, event),
      initialState,
    ) as T;
  }

  private getReducer(
    entityType: EventEntityType,
  ): (state: AggregateState, event: EventLedger) => AggregateState {
    switch (String(entityType).toUpperCase()) {
      case 'ADOPTION':
        return adoptionReducer;
      case 'PET':
        return petReducer;
      case 'CUSTODY':
        return custodyReducer;
      case 'ESCROW':
        return escrowReducer;
      case 'USER':
        return userReducer;
      default:
        return (state, event) => ({ ...state, ...asObject(event.payload) });
    }
  }
}
