import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { NotificationQueueService } from '../services/notification-queue.service';

export const DEFAULT_BULL_BOARD_PATH = '/admin/queues';

/**
 * Mounts Bull Board on the existing Nest/Express application.
 *
 * Bull Board provides a dashboard for queue monitoring and job management,
 * including viewing active/completed/failed jobs, inspecting payloads/logs,
 * and retrying failed jobs.
 */
export function setupBullBoard(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const notificationQueueService = app.get(NotificationQueueService);
  const bullBoardPath =
    configService.get<string>('BULL_BOARD_PATH') ?? DEFAULT_BULL_BOARD_PATH;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(bullBoardPath);

  createBullBoard({
    queues: [new BullMQAdapter(notificationQueueService.getQueue())],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Pet Adoption Queue Dashboard',
      },
    },
  });

  app.use(bullBoardPath, serverAdapter.getRouter());
}