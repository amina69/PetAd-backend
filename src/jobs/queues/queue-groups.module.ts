import { Module } from '@nestjs/common';
import { DataExportQueueModule } from './data-export-queue.module';
import { NotificationsQueueModule } from './notifications-queue.module';
import { PlannedQueueGroupsModule } from './planned-queue-groups.module';

@Module({
  imports: [
    NotificationsQueueModule,
    DataExportQueueModule,
    PlannedQueueGroupsModule,
  ],
  exports: [
    NotificationsQueueModule,
    DataExportQueueModule,
    PlannedQueueGroupsModule,
  ],
})
export class QueueGroupsModule {}
