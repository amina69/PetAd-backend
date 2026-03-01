import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class TrustScoreService {
  private readonly logger = new Logger(TrustScoreService.name);

  // Trust score adjustment constants
  private readonly SUCCESSFUL_CUSTODY_BONUS = 5;
  private readonly VIOLATION_PENALTY = 15;
  private readonly MIN_TRUST_SCORE = 0;
  private readonly MAX_TRUST_SCORE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async increaseTrustScore(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trustScore: true },
    });

    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const newScore = Math.min(
      this.MAX_TRUST_SCORE,
      user.trustScore + amount,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { trustScore: newScore },
    });

    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: userId,
      eventType: 'TRUST_SCORE_UPDATED',
      actorId: userId,
      payload: {
        oldScore: user.trustScore,
        newScore,
        change: amount,
        reason,
      },
    });

    this.logger.log(
      `Trust score increased for user ${userId}: ${user.trustScore} → ${newScore} (+${amount}) - ${reason}`,
    );

    return newScore;
  }

  async decreaseTrustScore(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trustScore: true },
    });

    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const newScore = Math.max(
      this.MIN_TRUST_SCORE,
      user.trustScore - amount,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { trustScore: newScore },
    });

    await this.eventsService.logEvent({
      entityType: 'USER',
      entityId: userId,
      eventType: 'TRUST_SCORE_UPDATED',
      actorId: userId,
      payload: {
        oldScore: user.trustScore,
        newScore,
        change: -amount,
        reason,
      },
    });

    this.logger.log(
      `Trust score decreased for user ${userId}: ${user.trustScore} → ${newScore} (-${amount}) - ${reason}`,
    );

    return newScore;
  }

  async rewardSuccessfulCustody(userId: string, custodyId: string) {
    return this.increaseTrustScore(
      userId,
      this.SUCCESSFUL_CUSTODY_BONUS,
      `Successful custody return: ${custodyId}`,
    );
  }

  async penalizeViolation(userId: string, custodyId: string) {
    return this.decreaseTrustScore(
      userId,
      this.VIOLATION_PENALTY,
      `Custody violation: ${custodyId}`,
    );
  }
}
