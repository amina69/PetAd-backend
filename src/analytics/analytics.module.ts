import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { AdoptionAnalyticsService } from './adoption-analytics.service';
import { DailyAggregatesProjectionService } from './projections/daily-aggregates.projection';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AdoptionAnalyticsService, DailyAggregatesProjectionService],
  exports: [AdoptionAnalyticsService, DailyAggregatesProjectionService],
})
export class AnalyticsModule {}
