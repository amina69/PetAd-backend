import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  DomainEvent,
  NotificationMapperService,
} from './notification-mapper.service';

const CURSOR_ID = 'notification-outbox';
const BATCH_SIZE = 50;

/**
 * Consumes domain events from the append-only event log and hands them to
 * the notification mapper.
 *
 * Events are read in `(createdAt, id)` order and the cursor is persisted, so
 * a restart resumes where it left off. Re-reading an event is harmless:
 * notification dedupe is enforced by the unique `(eventId, userId, channel)`
 * key. When issue #73's outbox lands, this consumer can be switched to it
 * without changing the mapper.
 */
@Injectable()
export class NotificationOutboxConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationOutboxConsumer.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mapper: NotificationMapperService,
  ) {}

  onModuleInit(): void {
    const interval = Math.max(
      100,
      this.configService.get<number>('NOTIFICATION_OUTBOX_POLL_MS') ?? 5000,
    );

    this.timer = setInterval(() => {
      void this.poll();
    }, interval);
    // Do not keep the Node process alive just for the poller.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Runs one drain pass; exposed for tests and operational replays. */
  async consumeOnce(): Promise<number> {
    let processed = 0;
    let batchCount = 0;

    do {
      batchCount = await this.consumeBatch();
      processed += batchCount;
    } while (batchCount === BATCH_SIZE);

    return processed;
  }

  private async poll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.consumeOnce();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification outbox poll failed: ${reason}`);
    } finally {
      this.running = false;
    }
  }

  private async consumeBatch(): Promise<number> {
    const cursor = await this.getCursor();

    const events = await this.prisma.eventLog.findMany({
      where: {
        OR: [
          { createdAt: { gt: cursor.lastCreatedAt } },
          {
            createdAt: cursor.lastCreatedAt,
            id: { gt: cursor.lastEventId },
          },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
    });

    for (const event of events) {
      const domainEvent: DomainEvent = {
        id: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        actorId: event.actorId,
        payload: event.payload,
        createdAt: event.createdAt,
      };

      try {
        await this.mapper.handleEvent(domainEvent);
      } catch (error) {
        // Advance the cursor regardless: a permanently failing event must
        // not block the whole stream. The failure is visible in the logs.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to map event ${event.id} (${event.eventType}): ${reason}`,
        );
      }

      await this.advanceCursor(event.createdAt, event.id);
    }

    return events.length;
  }

  private async getCursor() {
    const existing = await this.prisma.notificationOutboxCursor.findUnique({
      where: { id: CURSOR_ID },
    });
    if (existing) {
      return existing;
    }

    // First run: start from "now" so booting the service does not email
    // users about every historical event.
    const latest = await this.prisma.eventLog.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    });

    try {
      return await this.prisma.notificationOutboxCursor.create({
        data: {
          id: CURSOR_ID,
          lastCreatedAt: latest?.createdAt ?? new Date(),
          lastEventId: latest?.id ?? '',
        },
      });
    } catch {
      // Another instance created the cursor first; adopt it.
      const cursor = await this.prisma.notificationOutboxCursor.findUnique({
        where: { id: CURSOR_ID },
      });
      if (cursor) {
        return cursor;
      }
      throw new Error('Failed to initialise the notification outbox cursor');
    }
  }

  private async advanceCursor(
    lastCreatedAt: Date,
    lastEventId: string,
  ): Promise<void> {
    await this.prisma.notificationOutboxCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID, lastCreatedAt, lastEventId },
      update: { lastCreatedAt, lastEventId },
    });
  }
}
