import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { getRedisConnection } from '../jobs/queues/queue.config';
import { SCHEDULES, SCHEDULER_QUEUE } from './scheduler.registry';

/**
 * Shared BullMQ JobSchedulers produce one job per tick across replicas.
 * Workers must still implement idempotent business operations, since BullMQ
 * may retry jobs after failures or lock loss.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    // Keep disabled until domain handlers are wired; never enqueue failing maintenance jobs in production.
    if (process.env.SCHEDULER_ENABLED !== 'true') {
      this.logger.warn('Scheduler disabled: set SCHEDULER_ENABLED=true only after handlers are implemented');
      return;
    }
    const connection = getRedisConnection(this.config);
    this.queue = new Queue(SCHEDULER_QUEUE, { connection });
    for (const schedule of SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.name, { pattern: schedule.pattern }, {
        name: schedule.name,
        data: {},
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      });
    }
    this.worker = new Worker(SCHEDULER_QUEUE, async (job: Job) => {
      const start = Date.now();
      try {
        // Fail explicitly until the corresponding domain handler is wired.
        // Silent success would falsely report that retention or expiry ran.
        throw new Error(`Scheduler handler not yet registered: ${job.name}`);
      } finally {
        this.logger.log(`Scheduler ${job.name} durationMs=${Date.now() - start}`);
      }
    }, { connection, concurrency: 1 });
  }

  async status() {
    if (!this.queue) return [];
    return Promise.all(SCHEDULES.map(async (schedule) => {
      const scheduler = await this.queue!.getJobScheduler(schedule.name);
      const jobs = await this.queue!.getJobs(['completed', 'failed'], 0, 200);
      const last = jobs.filter((job) => job.name === schedule.name)
        .sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0))[0];
      return {
        name: schedule.name,
        pattern: schedule.pattern,
        nextRun: scheduler?.next ?? null,
        lastRun: last?.finishedOn ?? null,
        durationMs: last?.finishedOn && last.processedOn
          ? last.finishedOn - last.processedOn : null,
        result: last ? (last.failedReason ? 'failed' : 'completed') : 'never',
        error: last?.failedReason || null,
      };
    }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
