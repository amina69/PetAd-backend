import { Injectable } from '@nestjs/common';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { WebhookHandlerRegistry } from '../webhook-handler.registry';
import { WebhookJobPayload } from '../webhook.queue.service';

@Injectable()
export class WebhookProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logging: LoggingService,
    private readonly handlers: WebhookHandlerRegistry,
  ) {}

  async process(payload: WebhookJobPayload): Promise<void> {
    const delivery = await this.prisma.webhookEvent.findUnique({
      where: { id: payload.deliveryId },
    });
    if (
      !delivery ||
      (delivery.status !== WebhookDeliveryStatus.RECEIVED &&
        delivery.status !== WebhookDeliveryStatus.FAILED)
    ) {
      return;
    }

    await this.prisma.webhookEvent.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.PROCESSING,
        attempts: { increment: 1 },
      },
    });

    try {
      const eventPayload =
        delivery.payload && typeof delivery.payload === 'object'
          ? (delivery.payload as Record<string, unknown>)
          : {};
      await this.handlers.handle({
        provider: delivery.provider,
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        payload: eventPayload,
        deliveryId: delivery.id,
      });

      await this.prisma.webhookEvent.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.PROCESSED,
          processedAt: new Date(),
          error: null,
        },
      });
      await this.logging.log({
        level: 'INFO',
        action: 'WEBHOOK_PROCESSED',
        message: `Processed ${delivery.provider} webhook ${delivery.eventId}`,
        metadata: {
          deliveryId: delivery.id,
          provider: delivery.provider,
          eventId: delivery.eventId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.webhookEvent.update({
        where: { id: delivery.id },
        data: { status: WebhookDeliveryStatus.FAILED, error: message },
      });
      await this.logging.log({
        level: 'ERROR',
        action: 'WEBHOOK_FAILED',
        message: `Failed to process ${delivery.provider} webhook ${delivery.eventId}`,
        metadata: {
          deliveryId: delivery.id,
          provider: delivery.provider,
          eventId: delivery.eventId,
          error: message,
        },
      });
      throw error;
    }
  }
}
