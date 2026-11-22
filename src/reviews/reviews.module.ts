import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrustModule } from '../trust/trust.module';
import { ReviewModerationController } from './review-moderation.controller';
import { ReviewModerationService } from './review-moderation.service';
import { ReviewSummaryService } from './review-summary.service';

@Module({
  imports: [PrismaModule, NotificationsModule, TrustModule],
  controllers: [ReviewModerationController],
  providers: [ReviewModerationService, ReviewSummaryService],
  exports: [ReviewModerationService, ReviewSummaryService],
})
export class ReviewsModule {}
