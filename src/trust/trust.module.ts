import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggingModule } from '../logging/logging.module';
import { AntiAbuseDetector } from './anti-abuse/anti-abuse.detector';
import { AntiAbuseService } from './anti-abuse/anti-abuse.service';
import { ReviewService } from './anti-abuse/review.service';
import { TrustScoreService } from './anti-abuse/trust-score.service';
import { ReviewsController } from './anti-abuse/reviews.controller';
import { TrustAdminController } from './anti-abuse/trust-admin.controller';

@Module({
  imports: [PrismaModule, LoggingModule],
  controllers: [ReviewsController, TrustAdminController],
  providers: [
    AntiAbuseDetector,
    AntiAbuseService,
    ReviewService,
    TrustScoreService,
  ],
  exports: [AntiAbuseService, ReviewService, TrustScoreService],
})
export class TrustModule {}
