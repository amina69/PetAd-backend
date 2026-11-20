import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { DataExportQueueService } from '../users/data-export/data-export-queue.service';

/** Refresh snapshot gauges before each scrape; never expose individual records. */
@Injectable()
export class MetricsCollector {
  private readonly logger = new Logger(MetricsCollector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly notifications: NotificationQueueService,
    private readonly exports: DataExportQueueService,
  ) {}

  async collect(): Promise<void> {
    const tasks = [
      this.collectEscrows(),
      this.collectDatabase(),
      this.notifications.collectMetrics(),
      this.exports.collectMetrics(),
      this.collectAnchoringLag(),
    ];
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn('One metrics collector failed; serving available metrics');
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
    // PostgreSQL reports per-database connections; it is not a process-local
    // adapter pool statistic. Export this honestly as a database-level gauge.
    const rows = await this.prisma.$queryRaw<Array<{ connections: bigint }>>`
      SELECT COUNT(*)::bigint AS connections
      FROM pg_stat_activity WHERE datname = current_database()
    `;
    this.metrics.setDbPoolStats({
      totalCount: Number(rows[0]?.connections ?? 0),
      idleCount: 0,
      waitingCount: 0,
    });
  }

  private async collectAnchoringLag(): Promise<void> {
    const oldest = await this.prisma.eventLog.findFirst({
      where: { txHash: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    this.metrics.setAnchoringLag(
      oldest ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
    );
  }
}
