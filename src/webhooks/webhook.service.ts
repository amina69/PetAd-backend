import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import { WebhookSignatureService, VerifiedWebhook } from './webhook-signature.service';
import { WebhookQueueService } from './webhook.queue.service';

export interface ReceiveResult {
  received: boolean;
  duplicate: boolean;
  deliveryId?: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signatures: WebhookSignatureService,
    private readonly queue: WebhookQueueService,
    private readonly logging: LoggingService,
  ) {}

  async receive(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, unknown>,
  ): Promise<ReceiveResult> {
    const verified: VerifiedWebhook = this.signatures.verify(
      provider,
      rawBody,
      headers,
    );

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Webhook payload must be valid JSON');
    }

    let delivery;
    try {
      delivery = await this.prisma.webhookEvent.create({
        data: {
          provider,
          eventId: verified.eventId,
          eventType: verified.eventType,
          payload: payload as Prisma.InputJsonValue,
          status: 'RECEIVED',
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.logging.log({
          level: 'INFO',
          action: 'WEBHOOK_DUPLICATE',
          message: `Ignored duplicate ${provider} webhook ${verified.eventId}`,
          metadata: { provider, eventId: verified.eventId },
        });
        return { received: true, duplicate: true };
      }
      throw error;
    }

    const auditMetadata = {
      deliveryId: delivery.id,
      provider,
      eventId: verified.eventId,
      eventType: verified.eventType,
      timestamp: verified.timestamp,
    };
    await this.logging.log({
      level: 'INFO',
      action: 'WEBHOOK_RECEIVED',
      message: `Received ${provider} webhook ${verified.eventId}`,
      metadata: auditMetadata,
    });

    try {
      await this.queue.enqueueWebhook({
        deliveryId: delivery.id,
        provider,
        eventId: verified.eventId,
        eventType: verified.eventType,
      });
    } catch (error) {
      // Roll back the idempotency marker so a provider retry can process it.
      await this.prisma.webhookEvent.delete({ where: { id: delivery.id } });
      await this.logging.log({
        level: 'ERROR',
        action: 'WEBHOOK_ENQUEUE_FAILED',
        message: `Could not enqueue ${provider} webhook ${verified.eventId}`,
        metadata: {
          ...auditMetadata,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.logger.error(
        `Webhook enqueue failed for ${provider}/${verified.eventId}: ${String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Webhook could not be queued for processing',
      );
    }

    return { received: true, duplicate: false, deliveryId: delivery.id };
  }
}
