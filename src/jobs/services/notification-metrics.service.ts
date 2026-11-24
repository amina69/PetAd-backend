import { Injectable } from '@nestjs/common';

export interface NotificationMetricsSnapshot {
  queued: number;
  sent: number;
  failed: number;
  deadLettered: number;
  averageLatencyMs: number;
}

/**
 * In-process counters for the notification pipeline. They are exposed via
 * `snapshot()` for a metrics scraper or health/ops endpoint without adding
 * a metrics dependency to the project.
 */
@Injectable()
export class NotificationMetricsService {
  private queued = 0;
  private sent = 0;
  private failed = 0;
  private deadLettered = 0;
  private latencySumMs = 0;
  private latencyCount = 0;

  recordQueued(): void {
    this.queued += 1;
  }

  recordSent(latencyMs: number): void {
    this.sent += 1;
    this.recordLatency(latencyMs);
  }

  recordFailed(latencyMs: number): void {
    this.failed += 1;
    this.recordLatency(latencyMs);
  }

  recordDeadLettered(): void {
    this.deadLettered += 1;
  }

  snapshot(): NotificationMetricsSnapshot {
    return {
      queued: this.queued,
      sent: this.sent,
      failed: this.failed,
      deadLettered: this.deadLettered,
      averageLatencyMs:
        this.latencyCount === 0
          ? 0
          : Math.round(this.latencySumMs / this.latencyCount),
    };
  }

  reset(): void {
    this.queued = 0;
    this.sent = 0;
    this.failed = 0;
    this.deadLettered = 0;
    this.latencySumMs = 0;
    this.latencyCount = 0;
  }

  private recordLatency(latencyMs: number): void {
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.latencySumMs += latencyMs;
      this.latencyCount += 1;
    }
  }
}
