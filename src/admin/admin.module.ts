import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminStatsController } from './admin-stats.controller';
import { EventReplayService } from './services/event-replay.service';
import { AdminStatsService } from './services/admin-stats.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';
import { TrustModule } from '../trust/trust.module';

@Module({
  imports: [PrismaModule, LoggingModule, TrustModule],
  controllers: [AdminController, AdminStatsController],
  providers: [EventReplayService, AdminStatsService],
  exports: [EventReplayService, AdminStatsService],
})
export class AdminModule {}
