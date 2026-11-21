import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ShelterAnalyticsController } from './shelter-analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [AnalyticsController, ShelterAnalyticsController],
  providers: [AnalyticsService, ShelterAnalyticsService],
  exports: [AnalyticsService, ShelterAnalyticsService],
})
export class AnalyticsModule {}
