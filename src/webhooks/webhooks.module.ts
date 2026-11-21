import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookQueueService } from './webhook.queue.service';
import { WebhookProcessor } from './processors/webhook.processor';
import { WebhookWorker } from './workers/webhook.worker';
import { WebhookHandlerRegistry } from './webhook-handler.registry';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookSignatureService,
    WebhookQueueService,
    WebhookProcessor,
    WebhookWorker,
    {
      provide: WebhookHandlerRegistry,
      useFactory: () => new WebhookHandlerRegistry([]),
    },
  ],
  exports: [WebhookService, WebhookHandlerRegistry],
})
export class WebhooksModule {}
