import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OUTBOX_QUEUE_NAME,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
} from './outbox.types';
import { getRedisConnection } from '../../jobs/queues/queue.config';

@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly queue: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.queue = new Queue(OUTBOX_QUEUE_NAME, {
      connection: getRedisConnection(configService),
    });
  }

  /**
   * Poll for PENDING outbox messages and enqueue them to BullMQ.
   *
   * Uses `SELECT … FOR UPDATE SKIP LOCKED` so two relay instances running
   * concurrently never pick up the same row.  Marking a message SENT happens
   * in the same transaction as the lock, ensuring at-least-once delivery
   * without double-publishing.
   */
  async relay(): Promise<number> {
    let relayed = 0;

    const pending = await this.prisma.$queryRaw<
      Array<{ id: string; type: string; payload: unknown; attempts: number }>
    >`
      SELECT id, type, payload, attempts
      FROM outbox_messages
      WHERE status = 'PENDING'
        AND available_at <= NOW()
      ORDER BY available_at
      LIMIT ${OUTBOX_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;

    for (const msg of pending) {
      try {
        await this.queue.add(msg.type, msg.payload, {
          jobId: msg.id,
          attempts: 3,
          backoff: { type: 'fixed', delay: 5000 },
        });

        await this.prisma.$executeRaw`
          UPDATE outbox_messages
          SET status = 'SENT', sent_at = NOW(), updated_at = NOW()
          WHERE id = ${msg.id}
        `;

        relayed++;
      } catch (err) {
        const nextAttempts = msg.attempts + 1;
        const newStatus =
          nextAttempts >= OUTBOX_MAX_ATTEMPTS ? 'FAILED' : 'PENDING';

        await this.prisma.$executeRaw`
          UPDATE outbox_messages
          SET attempts = ${nextAttempts},
              status   = ${newStatus}::\"OutboxStatus\",
              error    = ${String(err)},
              updated_at = NOW()
          WHERE id = ${msg.id}
        `;

        this.logger.error(
          `Outbox relay failed for message ${msg.id}: ${String(err)}`,
        );
      }
    }

    return relayed;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
