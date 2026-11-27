import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ShelterAnalyticsController } from './shelter-analytics.controller';
import { PredictiveInsightsController } from './insights/predictive-insights.controller';
import { AnalyticsService } from './analytics.service';
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { GeoAnalyticsService } from './geo-analytics.service';
import { PredictiveInsightsService } from './insights/predictive-insights.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [
    AnalyticsController,
    ShelterAnalyticsController,
    PredictiveInsightsController,
  ],
  providers: [
    AnalyticsService,
    ShelterAnalyticsService,
    GeoAnalyticsService,
    PredictiveInsightsService,
  ],
  exports: [
    AnalyticsService,
    ShelterAnalyticsService,
    GeoAnalyticsService,
    PredictiveInsightsService,
  ],
})
export class AnalyticsModule {}
