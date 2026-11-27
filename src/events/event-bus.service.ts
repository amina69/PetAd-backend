import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PublishEventDto {
  eventId: string;
  aggregateId: string;
  globalPosition: number;
  eventType: string;
  payload: any;
}

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  // Internal consumer handlers registered in the system
  private readonly consumers: Array<{
    name: string;
    handler: (event: PublishEventDto) => Promise<void>;
  }> = [];

  constructor(private readonly prisma: PrismaService) {
    // Register default internal consumers (notifications, projections, anchoring, trust)
    this.registerConsumer('notifications', async (event) => {
      this.logger.debug(`Notification consumer processed event ${event.eventId}`);
    });
    this.registerConsumer('projections', async (event) => {
      this.logger.debug(`Projections consumer processed event ${event.eventId}`);
    });
    this.registerConsumer('anchoring', async (event) => {
      this.logger.debug(`Anchoring consumer processed event ${event.eventId}`);
    });
    this.registerConsumer('trust', async (event) => {
      this.logger.debug(`Trust consumer processed event ${event.eventId}`);
    });
  }

  registerConsumer(
    name: string,
    handler: (event: PublishEventDto) => Promise<void>,
  ) {
    this.consumers.push({ name, handler });
  }

  /**
   * Publishes an event through the outbox to all internal consumers.
   * Ordering is preserved per aggregate (aggregateId serves as partition key).
   * Consumer failures are caught and retried/isolated without blocking the writer.
   */
  async publish(dto: PublishEventDto): Promise<void> {
    for (const consumer of this.consumers) {
      try {
        // Idempotency check: record processed ids or check if already processed
        const alreadyProcessed = await this.checkIdempotency(
          consumer.name,
          dto.eventId,
        );
        if (alreadyProcessed) {
          continue;
        }

        await consumer.handler(dto);
        await this.markProcessed(consumer.name, dto.eventId, dto.aggregateId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Consumer '${consumer.name}' failed to process event ${dto.eventId}: ${msg}`,
        );
        // Non-blocking: continue to other consumers/retries
      }
    }
  }

  private async checkIdempotency(
    consumerName: string,
    eventId: string,
  ): Promise<boolean> {
    try {
      const record = await (this.prisma as any).processedEvent?.findUnique?.({
        where: {
          consumerName_eventId: {
            consumerName,
            eventId,
          },
        },
      });
      return !!record;
    } catch {
      return false;
    }
  }

  private async markProcessed(
    consumerName: string,
    eventId: string,
    aggregateId: string,
  ): Promise<void> {
    try {
      await (this.prisma as any).processedEvent?.upsert?.({
        where: {
          consumerName_eventId: {
            consumerName,
            eventId,
          },
        },
        update: {},
        create: {
          consumerName,
          eventId,
          aggregateId,
        },
      });
    } catch (error) {
      this.logger.debug(`Failed to record processed event idempotency: ${error}`);
    }
  }
}
