import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { EventReplayService } from './services/event-replay.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [PrismaModule, LoggingModule, SchedulerModule],
  controllers: [AdminController],
  providers: [EventReplayService],
  exports: [EventReplayService],
})
export class AdminModule {}
