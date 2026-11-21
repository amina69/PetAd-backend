import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TrustScoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Weighted trust score derived from visible and down-weighted reviews.
   * Flagged reviews still contribute, but with their reduced weight; hidden
   * reviews are excluded entirely. Moderators, never this calculation, decide
   * whether an account is punished.
   */
  async calculate(userId: string): Promise<number> {
    const [reviews, user] = await Promise.all([
      this.prisma.review.findMany({
        where: {
          revieweeId: userId,
          status: { in: ['VISIBLE', 'FLAGGED'] },
        },
        select: { rating: true, weight: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { trustScore: true },
      }),
    ]);

    const weightSum = reviews.reduce((sum, review) => sum + review.weight, 0);
    if (weightSum === 0) return user?.trustScore ?? 50;

    const weightedRating = reviews.reduce(
      (sum, review) => sum + review.rating * review.weight,
      0,
    );
    const average = weightedRating / weightSum;
    return Math.round((((average - 1) / 4) * 100 + Number.EPSILON) * 100) / 100;
  }
}
