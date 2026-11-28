import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from '../../email/email.module';
import { LoggingModule } from '../../logging/logging.module';
import { QueueInfrastructureModule } from './queue-infrastructure.module';
import { NotificationProcessor } from '../processors/notification.processor';
import { NotificationQueueService } from '../services/notification-queue.service';
import { NotificationWorker } from '../workers/notification.worker';

@Module({
  imports: [
    ConfigModule,
    EmailModule,
    LoggingModule,
    QueueInfrastructureModule,
  ],
  providers: [
    NotificationProcessor,
    NotificationQueueService,
    NotificationWorker,
  ],
  exports: [NotificationProcessor, NotificationQueueService],
})
export class NotificationsQueueModule {}
