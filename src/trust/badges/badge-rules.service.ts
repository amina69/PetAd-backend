import { Injectable } from '@nestjs/common';
import { BadgeCode, EventEntityType, EventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface BadgeRuleUser {
  id: string;
  role: string;
  trustScore: number;
  stellarPublicKey: string | null;
  status: string;
  createdAt: Date;
}

export interface BadgeRuleResult {
  holds: boolean;
  /** Ledger events that justify the award. Empty means "not justified". */
  supportingEventIds: string[];
  reason: string;
}

const COMPLETED_AGREEMENT_EVENTS: EventType[] = [
  EventType.ADOPTION_COMPLETED,
  EventType.CUSTODY_COMPLETED,
];

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Rule evaluation for each badge. A rule only holds when it also has at least
 * one supporting ledger event, so every awarded badge is auditable.
 */
@Injectable()
export class BadgeRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    code: BadgeCode,
    user: BadgeRuleUser,
  ): Promise<BadgeRuleResult> {
    if (user.status !== 'ACTIVE') {
      return {
        holds: false,
        supportingEventIds: [],
        reason: `Account status is ${user.status}`,
      };
    }

    switch (code) {
      case BadgeCode.ID_VERIFIED:
        return this.idVerified(user);
      case BadgeCode.TRUSTED_ADOPTER:
        return this.trustedAdopter(user);
      case BadgeCode.VERIFIED_SHELTER:
        return this.verifiedShelter(user);
      case BadgeCode.CLEAN_RECORD_12M:
        return this.cleanRecord(user);
      default:
        return {
          holds: false,
          supportingEventIds: [],
          reason: `No rule is defined for badge ${code}`,
        };
    }
  }

  private async idVerified(user: BadgeRuleUser): Promise<BadgeRuleResult> {
    const supportingEventIds = await this.registrationEventIds(user.id);

    if (!user.stellarPublicKey) {
      return {
        holds: false,
        supportingEventIds,
        reason: 'No verified Stellar account is linked',
      };
    }

    return {
      holds: supportingEventIds.length > 0,
      supportingEventIds,
      reason: 'Identity is anchored to a verified Stellar account',
    };
  }

  private async verifiedShelter(user: BadgeRuleUser): Promise<BadgeRuleResult> {
    const supportingEventIds = await this.registrationEventIds(user.id);

    return {
      holds: user.role === 'SHELTER' && supportingEventIds.length > 0,
      supportingEventIds,
      reason:
        user.role === 'SHELTER'
          ? 'Registered shelter account'
          : 'Account is not a shelter',
    };
  }

  private async trustedAdopter(user: BadgeRuleUser): Promise<BadgeRuleResult> {
    const [adoptions, custodies] = await Promise.all([
      this.prisma.adoption.findMany({
        where: {
          status: 'COMPLETED',
          OR: [{ adopterId: user.id }, { ownerId: user.id }],
        },
        select: { id: true },
      }),
      this.prisma.custody.findMany({
        where: { status: 'COMPLETED', holderId: user.id },
        select: { id: true },
      }),
    ]);

    const completedAgreements = adoptions.length + custodies.length;

    const supporting = await this.prisma.eventLog.findMany({
      where: {
        eventType: { in: COMPLETED_AGREEMENT_EVENTS },
        OR: [
          {
            entityType: EventEntityType.ADOPTION,
            entityId: { in: adoptions.map((adoption) => adoption.id) },
          },
          {
            entityType: EventEntityType.CUSTODY,
            entityId: { in: custodies.map((custody) => custody.id) },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const supportingEventIds = supporting.map((event) => event.id);
    const holds =
      completedAgreements >= 3 &&
      user.trustScore >= 80 &&
      supportingEventIds.length > 0;

    return {
      holds,
      supportingEventIds,
      reason: holds
        ? `${completedAgreements} completed agreements with trust score ${user.trustScore}`
        : `Requires 3 completed agreements and a trust score of 80 ` +
          `(${completedAgreements} agreements, score ${user.trustScore})`,
    };
  }

  private async cleanRecord(user: BadgeRuleUser): Promise<BadgeRuleResult> {
    const since = new Date(Date.now() - TWELVE_MONTHS_MS);
    const supportingEventIds = await this.registrationEventIds(user.id);

    if (user.createdAt > since) {
      return {
        holds: false,
        supportingEventIds,
        reason: 'Account is younger than 12 months',
      };
    }

    const [violations, suspensions] = await Promise.all([
      this.prisma.eventLog.count({
        where: {
          eventType: EventType.CUSTODY_VIOLATION,
          actorId: user.id,
          createdAt: { gte: since },
        },
      }),
      this.prisma.eventLog.count({
        where: {
          entityType: EventEntityType.USER,
          entityId: user.id,
          eventType: EventType.USER_SUSPENDED,
          createdAt: { gte: since },
        },
      }),
    ]);

    const holds = violations === 0 && suspensions === 0;

    return {
      holds: holds && supportingEventIds.length > 0,
      supportingEventIds,
      reason: holds
        ? 'No violations or suspensions in the last 12 months'
        : 'Clean record requires no violations or suspensions ' +
          `(${violations} violations, ${suspensions} suspensions)`,
    };
  }

  private async registrationEventIds(userId: string): Promise<string[]> {
    const events = await this.prisma.eventLog.findMany({
      where: {
        entityType: EventEntityType.USER,
        entityId: userId,
        eventType: EventType.USER_REGISTERED,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    return events.map((event) => event.id);
  }
}
