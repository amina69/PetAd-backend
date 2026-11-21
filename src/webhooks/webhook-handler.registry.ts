import { Injectable, Logger } from '@nestjs/common';

export interface WebhookHandlerContext {
  provider: string;
  eventId: string;
  eventType: string | null;
  payload: Record<string, unknown>;
  deliveryId: string;
}

export interface WebhookHandler {
  readonly provider: string;
  handle(context: WebhookHandlerContext): Promise<void>;
}

@Injectable()
export class WebhookHandlerRegistry {
  private readonly logger = new Logger(WebhookHandlerRegistry.name);

  constructor(private readonly handlers: WebhookHandler[] = []) {}

  async handle(context: WebhookHandlerContext): Promise<void> {
    const handlers = this.handlers.filter(
      (handler) => handler.provider === context.provider,
    );
    if (handlers.length === 0) {
      this.logger.log(
        `No provider handler registered for ${context.provider}; event ${context.eventId} acknowledged without side effects`,
      );
      return;
    }
    for (const handler of handlers) {
      await handler.handle(context);
    }
  }
}
