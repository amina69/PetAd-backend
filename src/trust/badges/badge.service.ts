import { Injectable, NotFoundException } from '@nestjs/common';
import { BadgeCode, BadgeDefinition, UserBadge } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { BadgeRuleUser, BadgeRulesService } from './badge-rules.service';

export interface AwardedBadgeView {
  code: BadgeCode;
  name: string;
  description: string;
  awardedAt: Date;
  supportingEventIds: string[];
  reason: string | null;
}

type UserBadgeWithDefinition = UserBadge & { definition: BadgeDefinition };

/**
 * Awards and revokes rule-based badges.
 *
 * `evaluate()` is the trust projection: it re-runs every rule for a user and
 * reconciles the stored awards, so a badge is revoked as soon as its rule
 * stops holding. Awards keep the ids of the ledger events that justify them
 * and emit a BADGE_AWARDED / BADGE_REVOKED event of their own.
 */
@Injectable()
export class BadgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: BadgeRulesService,
    private readonly events: EventsService,
  ) {}

  async evaluate(userId: string): Promise<AwardedBadgeView[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        trustScore: true,
        stellarPublicKey: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user || user.status === 'DELETED') {
      throw new NotFoundException('User not found');
    }

    const definitions = await this.prisma.badgeDefinition.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    });

    for (const definition of definitions) {
      await this.reconcile(user, definition);
    }

    return this.listAwarded(userId);
  }

  async listAwarded(userId: string): Promise<AwardedBadgeView[]> {
    const badges = (await this.prisma.userBadge.findMany({
      where: { userId, status: 'AWARDED' },
      include: { definition: true },
      orderBy: { awardedAt: 'asc' },
    })) as UserBadgeWithDefinition[];

    return badges.map((badge) => this.toView(badge));
  }

  async awardedCodes(userId: string): Promise<BadgeCode[]> {
    const badges = await this.listAwarded(userId);
    return badges.map((badge) => badge.code);
  }

  private async reconcile(
    user: BadgeRuleUser,
    definition: BadgeDefinition,
  ): Promise<void> {
    const evaluation = await this.rules.evaluate(definition.code, user);

    const existing = await this.prisma.userBadge.findUnique({
      where: {
        userId_definitionId: {
          userId: user.id,
          definitionId: definition.id,
        },
      },
    });

    if (evaluation.holds) {
      const wasAwarded = existing?.status === 'AWARDED';
      const awardedAt = wasAwarded ? existing.awardedAt : new Date();

      const badge = await this.prisma.userBadge.upsert({
        where: {
          userId_definitionId: {
            userId: user.id,
            definitionId: definition.id,
          },
        },
        create: {
          userId: user.id,
          definitionId: definition.id,
          status: 'AWARDED',
          supportingEventIds: evaluation.supportingEventIds,
          reason: evaluation.reason,
          awardedAt,
        },
        update: {
          status: 'AWARDED',
          supportingEventIds: evaluation.supportingEventIds,
          reason: evaluation.reason,
          revokedAt: null,
          ...(wasAwarded ? {} : { awardedAt }),
        },
      });

      if (!wasAwarded) {
        await this.events.logEvent({
          entityType: 'BADGE',
          entityId: badge.id,
          eventType: 'BADGE_AWARDED',
          actorId: user.id,
          payload: {
            userId: user.id,
            badgeCode: definition.code,
            supportingEventIds: evaluation.supportingEventIds,
            reason: evaluation.reason,
          },
        });
      }

      return;
    }

    if (existing?.status === 'AWARDED') {
      const revoked = await this.prisma.userBadge.update({
        where: { id: existing.id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          reason: evaluation.reason,
        },
      });

      await this.events.logEvent({
        entityType: 'BADGE',
        entityId: revoked.id,
        eventType: 'BADGE_REVOKED',
        actorId: user.id,
        payload: {
          userId: user.id,
          badgeCode: definition.code,
          reason: evaluation.reason,
        },
      });
    }
  }

  private toView(badge: UserBadgeWithDefinition): AwardedBadgeView {
    return {
      code: badge.definition.code,
      name: badge.definition.name,
      description: badge.definition.description,
      awardedAt: badge.awardedAt,
      supportingEventIds: badge.supportingEventIds,
      reason: badge.reason,
    };
  }
}
