import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { NOTIFICATION_QUEUE_NAME, getRedisConnection } from '../queues/queue.config';

/**
 * Sets up Bull Board (queue monitoring UI) at /admin/queues.
 * - Disabled by default; enable via BULL_BOARD_ENABLED=true
 * - Loads @bull-board packages dynamically so missing dev dependencies don't break CI
 * - Registers the notification queue (notifications) created with BullMQ
 */
export function setupBullBoard(app: INestApplication): void {
  // Gate the dashboard behind an env var so CI and production can opt-out easily.
  if (!process.env.BULL_BOARD_ENABLED) return;

  // Load bull-board packages at runtime to avoid a hard build-time dependency.
  let createBullBoard: any;
  let ExpressAdapter: any;
  let BullMQAdapter: any;

  try {
    // Use require so the app can still compile if the packages aren't installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const bullBoard = require('@bull-board/api');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const expressAdapterMod = require('@bull-board/express');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const bullMQAdapterMod = require('@bull-board/api/bullMQAdapter');

    // Normalize exports for older/newer package shapes
    createBullBoard = bullBoard.createBullBoard ?? bullBoard.default ?? bullBoard;
    ExpressAdapter = expressAdapterMod.ExpressAdapter ?? expressAdapterMod.default ?? expressAdapterMod;
    BullMQAdapter = bullMQAdapterMod.BullMQAdapter ?? bullMQAdapterMod.default ?? bullMQAdapterMod;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Bull Board packages not available; skipping dashboard setup.');
    return;
  }

  try {
    // Resolve Redis connection from ConfigService (same config helper used across jobs)
    const configService = app.get(ConfigService);
    const connection = getRedisConnection(configService);

    // Create a Queue instance just for the dashboard adapter to inspect.
    const queue = new Queue(NOTIFICATION_QUEUE_NAME, { connection });

    const serverAdapter = new ExpressAdapter();
    if (typeof serverAdapter.setBasePath === 'function') {
      serverAdapter.setBasePath('/admin/queues');
    }

    // Create the UI and register the queue adapter(s)
    createBullBoard({
      queues: [new BullMQAdapter(queue)],
      serverAdapter,
    });

    // Mount the bull-board router into Nest's underlying Express instance
    // (Works when using the default HTTP adapter). If using Fastify this will be a no-op.
    const httpAdapter = (app as any).getHttpAdapter?.();
    const instance = httpAdapter?.getInstance?.();
    if (instance && typeof instance.use === 'function') {
      // serverAdapter.getRouter() is the Express router containing the UI endpoints
      instance.use('/admin/queues', serverAdapter.getRouter());
    } else {
      // eslint-disable-next-line no-console
      console.warn('Could not mount bull-board: unsupported HTTP adapter.');
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize bull-board:', err?.message ?? err);
  }
}