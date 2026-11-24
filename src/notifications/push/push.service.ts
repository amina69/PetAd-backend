import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePushSubscriptionDto } from './dto/push-subscription.dto';

/**
 * Fields a push payload is allowed to contain. Deliberately no email,
 * phone, addresses or document data: the payload is delivered through a
 * third-party push service and may be displayed on a locked device.
 */
export interface PushPayload {
  title: string;
  body: string;
  route?: string;
}

export interface PushSendResult {
  sent: number;
  pruned: number;
  skipped?: boolean;
}

const MAX_BODY_LENGTH = 140;

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const subject =
      this.configService.get<string>('VAPID_SUBJECT') ??
      'mailto:no-reply@petad.local';

    if (!publicKey || !privateKey) {
      this.logger.warn(
        'Web push disabled: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  async subscribe(
    userId: string,
    dto: CreatePushSubscriptionDto,
    userAgent?: string,
  ) {
    this.assertConfigured();

    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent,
      },
      // An endpoint that moves to a different account must follow the
      // authenticated user, otherwise we could push to the wrong device.
      update: {
        userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent,
      },
    });
  }

  async unsubscribe(
    userId: string,
    endpoint: string,
  ): Promise<{ deleted: number }> {
    const result = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { deleted: result.count };
  }

  /**
   * Sends a push to every subscription of a user. Expired endpoints
   * (404/410) are deleted immediately; other per-endpoint failures are
   * logged without failing the caller.
   */
  async sendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<PushSendResult> {
    if (!this.configured) {
      return { sent: 0, pruned: 0, skipped: true };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      return { sent: 0, pruned: 0, skipped: true };
    }

    // Whitelist the payload: never spread the notification record into it.
    const safePayload: PushPayload = {
      title: String(payload.title ?? '').slice(0, 120),
      body: String(payload.body ?? '').slice(0, MAX_BODY_LENGTH),
      ...(payload.route ? { route: payload.route } : {}),
    };

    let sent = 0;
    let pruned = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(safePayload),
          { TTL: 60 * 60 },
        );
        sent += 1;
      } catch (error) {
        const statusCode = this.statusCodeOf(error);
        if (statusCode === 404 || statusCode === 410) {
          await this.prisma.pushSubscription.deleteMany({
            where: { id: subscription.id },
          });
          pruned += 1;
          this.logger.log(
            `Pruned expired push subscription ${subscription.id} (status ${statusCode})`,
          );
          continue;
        }
        this.logger.warn(
          `Push send failed for subscription ${subscription.id} (status ${
            statusCode ?? 'unknown'
          })`,
        );
      }
    }

    return { sent, pruned };
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Web push is not configured on this server',
      );
    }
  }

  private statusCodeOf(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const candidate = error as { statusCode?: number };
    return typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : undefined;
  }
}
