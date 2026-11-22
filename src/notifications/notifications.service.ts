import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';

export interface UserNotification {
  subject: string;
  text: string;
}

/**
 * Best-effort user notifications over the transactional email queue.
 *
 * Notifications must never break the business flow that triggered them: a
 * missing recipient, an unconfigured mailer or an unavailable queue is logged
 * and swallowed. The authoritative record of the decision always lives in the
 * database and the event ledger.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueueService,
  ) {}

  async notifyUser(
    userId: string,
    notification: UserNotification,
  ): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, status: true },
      });

      if (!user || user.status !== 'ACTIVE') {
        return false;
      }

      await this.queue.enqueueSendTransactionalEmail({
        dto: {
          to: user.email,
          subject: notification.subject,
          text: notification.text,
        },
        metadata: { userId },
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to notify user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
