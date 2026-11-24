import { Inject, Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import {
  REALTIME_PUBLISHER,
  type RealtimePublisher,
} from '../realtime/realtime.publisher';
import { NotificationPreferencesService } from './notification-preferences.service';
import { toNotificationDto } from './notifications.service';

export interface DispatchNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** When set and the user allows email for this type, an email is queued. */
  sendEmail?: boolean;
}

/**
 * Single entry point for creating notifications. Every channel is gated by
 * the recipient's preferences, so disabling a type suppresses the in-app row
 * *and* the email/push delivery in one place.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    private readonly queue: NotificationQueueService,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
  ) {}

  async dispatch(
    input: DispatchNotificationInput,
  ): Promise<Notification | null> {
    const preference = await this.preferences.resolve(input.userId, input.type);

    let notification: Notification | null = null;

    if (preference.inApp) {
      notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data as never,
        },
      });

      this.realtime.publishToUser(input.userId, 'notification.created', {
        ...toNotificationDto(notification),
        ...(preference.push ? { push: true } : {}),
      });
    }

    if (preference.email && input.sendEmail) {
      await this.enqueueEmail(input);
    }

    return notification;
  }

  private async enqueueEmail(input: DispatchNotificationInput) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });

    if (!user?.email) {
      return;
    }

    try {
      await this.queue.enqueueSendTransactionalEmail({
        dto: {
          to: user.email,
          subject: input.title,
          text: input.body,
        },
        metadata: { notificationType: input.type, userId: input.userId },
      });
    } catch (error) {
      // A queue outage must not fail the originating business operation; the
      // in-app notification (if any) has already been persisted.
      this.logger.error(
        `Failed to enqueue notification email for user ${input.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
