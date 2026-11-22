import { Injectable } from '@nestjs/common';
import { BadgeService } from './badges/badge.service';

/**
 * Recomputes the trust inputs derived from agreements and reviews.
 *
 * Review moderation and other trust-affecting flows call this so badges
 * reflect the current state of the user immediately after a decision.
 */
@Injectable()
export class TrustProjectionService {
  constructor(private readonly badges: BadgeService) {}

  async recalculate(userId: string) {
    return this.badges.evaluate(userId);
  }
}
