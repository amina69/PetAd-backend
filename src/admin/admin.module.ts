import { Module } from '@nestjs/common';
import { AnchoringRecoveryService } from '../anchoring/anchoring-recovery.service';
import { AdminController } from './admin.controller';
import { AuditLogController } from './audit-log.controller';
import { AdminStatsController } from './admin-stats.controller';
import { EventReplayService } from './services/event-replay.service';
import { AuditLogService } from './services/audit-log.service';
import { AdminStatsService } from './services/admin-stats.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [PrismaModule, LoggingModule],
controllers: [AdminController, AuditLogController, AdminStatsController],
  providers: [EventReplayService, AnchoringRecoveryService, AuditLogService, AdminStatsService],
  exports: [EventReplayService, AuditLogService, AdminStatsService],
})
export class AdminModule {}
