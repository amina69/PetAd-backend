import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { EscrowStatus } from '@prisma/client';

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const ESCROW_STATES = Object.values(EscrowStatus);
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'completed', 'failed'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** Single registry: never register metrics in the global prom-client registry. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'petad_http_request_duration_seconds',
    help: 'HTTP request duration by method, route template and status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: HTTP_BUCKETS,
    registers: [this.registry],
  });
  readonly httpRequests = new Counter({
    name: 'petad_http_requests_total',
    help: 'HTTP responses by method, route template and status',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });
  readonly dbConnections = new Gauge({
    name: 'petad_db_connections',
    help: 'Current connections to the application PostgreSQL database',
    registers: [this.registry],
  });
  readonly queueJobs = new Gauge({
    name: 'petad_queue_jobs',
    help: 'BullMQ job counts by known queue and state',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });
  readonly stellarLatency = new Histogram({
    name: 'petad_stellar_call_duration_seconds',
    help: 'Latency of instrumented Stellar operations',
    labelNames: ['operation'] as const,
    buckets: HTTP_BUCKETS,
    registers: [this.registry],
  });
  readonly stellarFailures = new Counter({
    name: 'petad_stellar_call_failures_total',
    help: 'Failed instrumented Stellar operations',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });
  readonly escrowStates = new Gauge({
    name: 'petad_escrow_states',
    help: 'Stored escrows grouped by lifecycle state',
    labelNames: ['state'] as const,
    registers: [this.registry],
  });
  readonly anchoringLag = new Gauge({
    name: 'petad_anchoring_lag_seconds',
    help: 'Age of the oldest unanchored ledger event in seconds (when available)',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    for (const state of ESCROW_STATES) this.escrowStates.set({ state }, 0);
  }

  /** Only these static operation labels are accepted; arbitrary input becomes 'other'. */
  private stellarOperation(operation: string): string {
    return ['submit', 'fetch', 'account', 'transaction', 'anchor'].includes(operation)
      ? operation
      : 'other';
  }

  async measureStellar<T>(operation: string, work: () => Promise<T>): Promise<T> {
    const label = this.stellarOperation(operation);
    const stop = this.stellarLatency.startTimer({ operation: label });
    try {
      return await work();
    } catch (error) {
      this.stellarFailures.inc({ operation: label });
      throw error;
    } finally {
      stop();
    }
  }

  setDbConnections(count: number): void {
    this.dbConnections.set(count);
  }

  setQueueStats(queue: 'notifications' | 'data_export', counts: Partial<Record<QueueState, number>>): void {
    for (const state of QUEUE_STATES) {
      this.queueJobs.set({ queue, state }, counts[state] ?? 0);
    }
  }

  setEscrowCounts(counts: Partial<Record<EscrowStatus, number>>): void {
    for (const state of ESCROW_STATES) {
      this.escrowStates.set({ state }, counts[state] ?? 0);
    }
  }

  setAnchoringLag(seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0) this.anchoringLag.set(seconds);
  }
}
