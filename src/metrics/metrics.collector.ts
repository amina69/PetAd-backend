import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EventType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { DATA_EXPORT_QUEUE_NAME, NOTIFICATION_QUEUE_NAME, getRedisConnection } from '../jobs/queues/queue.config';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

/** Refresh snapshot gauges before each scrape; never expose individual records. */
@Injectable()
export class MetricsCollector {
  private readonly logger = new Logger(MetricsCollector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  async collect(): Promise<void> {
    const tasks = [
      this.collectEscrows(),
      this.collectDatabase(),
      this.collectQueues(),
      this.collectAnchoringLag(),
    ];
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn('One metrics collector failed; serving available metrics');
      }
    }
  }

  private async collectQueues(): Promise<void> {
    const connection = getRedisConnection(this.config);
    for (const name of [NOTIFICATION_QUEUE_NAME, DATA_EXPORT_QUEUE_NAME] as const) {
      const queue = new Queue(name, { connection });
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
        this.metrics.setQueueStats(name, counts);
      } finally {
        await queue.close();
      }
    }
  }

  private async collectEscrows(): Promise<void> {
    const rows = await this.prisma.escrow.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    this.metrics.setEscrowCounts(
      Object.fromEntries(rows.map((row) => [row.status, row._count._all])),
    );
  }

  private async collectDatabase(): Promise<void> {
    this.metrics.setDbPoolStats(this.prisma.getPoolStats());
  }

  private async collectAnchoringLag(): Promise<void> {
    const oldest = await this.prisma.eventLog.findFirst({
      where: {
        txHash: null,
        eventType: { in: [EventType.ESCROW_FUNDED, EventType.ESCROW_RELEASED, EventType.ESCROW_REFUNDED] },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    this.metrics.setAnchoringLag(
      oldest ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
    );
  }
}
