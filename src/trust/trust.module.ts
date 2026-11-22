import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BadgeRulesService } from './badges/badge-rules.service';
import { BadgeService } from './badges/badge.service';
import { BadgesController } from './badges/badges.controller';
import { TrustProjectionService } from './trust-projection.service';

@Module({
  imports: [PrismaModule],
  controllers: [BadgesController],
  providers: [BadgeRulesService, BadgeService, TrustProjectionService],
  exports: [BadgeService, TrustProjectionService],
})
export class TrustModule {}
