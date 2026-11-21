import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuditLogController } from './audit-log.controller';
import { EventReplayService } from './services/event-replay.service';
import { AuditLogService } from './services/audit-log.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [AdminController, AuditLogController],
  providers: [EventReplayService, AuditLogService],
  exports: [EventReplayService, AuditLogService],
})
export class AdminModule {}
