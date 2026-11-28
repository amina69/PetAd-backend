import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuditLogController } from './audit-log.controller';
import { AdminStatsController } from './admin-stats.controller';
import { EventReplayService } from './services/event-replay.service';
import { AdminQueuesService } from './services/admin-queues.service';
import { AuditLogService } from './services/audit-log.service';
import { AdminStatsService } from './services/admin-stats.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [PrismaModule, LoggingModule],
controllers: [AdminController, AuditLogController, AdminStatsController],
  providers: [EventReplayService, AdminQueuesService, AuditLogService, AdminStatsService],
  exports: [EventReplayService, AdminQueuesService, AuditLogService, AdminStatsService],
})
export class AdminModule {}
