import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventType, EventEntityType, Prisma } from '@prisma/client';

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

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Logs a system or user-generated event to the database.
   */
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
      return event;
    } catch (error) {
      this.logger.error(
        `Failed to log event ${dto.eventType}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
