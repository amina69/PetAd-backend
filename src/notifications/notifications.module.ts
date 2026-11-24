import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { JobsModule } from '../jobs/jobs.module';
import { PushModule } from './push/push.module';
import { NotificationMapperService } from './notification-mapper.service';
import { NotificationOutboxConsumer } from './notification-outbox.consumer';
import { NotificationsController } from './notifications.controller';
import { NotificationTemplateService } from './templates/notification-template.service';

@Module({
  imports: [ConfigModule, PrismaModule, EmailModule, JobsModule, PushModule],
  controllers: [NotificationsController],
  providers: [
    NotificationTemplateService,
    NotificationMapperService,
    NotificationOutboxConsumer,
  ],
  exports: [NotificationMapperService, NotificationTemplateService],
})
export class NotificationsModule {}
