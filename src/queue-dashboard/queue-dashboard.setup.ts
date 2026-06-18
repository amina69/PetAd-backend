import type { INestApplication } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Request, Response, NextFunction } from 'express';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';

const DASHBOARD_PATH = '/admin/queues';

/**
 * Mounts the Bull Board queue dashboard on the Express instance that NestJS
 * wraps. Must be called after `app.init()` so that all providers are resolved.
 *
 * Access is protected by HTTP Basic Auth using credentials from env vars:
 *   BULL_BOARD_USER  (default: "admin")
 *   BULL_BOARD_PASS  (default: "admin")  ← override in production
 *
 * Dashboard URL: /admin/queues
 */
export function setupQueueDashboard(app: INestApplication): void {
  const notificationQueueService = app.get(NotificationQueueService);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(DASHBOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(notificationQueueService.getQueue())],
    serverAdapter,
  });

  const dashboardUser =
    process.env.BULL_BOARD_USER?.trim() || 'admin';
  const dashboardPass =
    process.env.BULL_BOARD_PASS?.trim() || 'admin';

  // Basic-auth middleware — runs before the Bull Board router
  const basicAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Queue Dashboard"');
      res.status(401).send('Authentication required');
      return;
    }

    const base64 = authHeader.slice('Basic '.length);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [user, ...passParts] = decoded.split(':');
    const pass = passParts.join(':'); // handle colons in password

    if (user !== dashboardUser || pass !== dashboardPass) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Queue Dashboard"');
      res.status(401).send('Invalid credentials');
      return;
    }

    next();
  };

  // Mount: basicAuth → Bull Board router
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(DASHBOARD_PATH, basicAuth, serverAdapter.getRouter());

  console.log(
    `Queue dashboard available at: http://localhost:${process.env.PORT ?? 3001}${DASHBOARD_PATH}`,
  );
}
