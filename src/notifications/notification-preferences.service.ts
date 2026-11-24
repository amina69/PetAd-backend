import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_NOTIFICATION_TYPES,
  PreferenceItemDto,
} from './dto/update-preferences.dto';

export interface ResolvedPreference {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  push: boolean;
  canDisable: boolean;
}

/** Marketing-like types are opt-in: they are off unless the user turns them on. */
const DEFAULT_OFF: NotificationType[] = [NotificationType.MARKETING];

/**
 * Security notifications are always delivered: they protect the account
 * itself, so a user must not be able to switch them off (accidentally or
 * otherwise).
 */
const SECURITY_TYPES: NotificationType[] = [
  NotificationType.SECURITY_PASSWORD_CHANGED,
  NotificationType.SECURITY_2FA,
  NotificationType.SECURITY_NEW_DEVICE,
];

export function isSecurityType(type: NotificationType): boolean {
  return SECURITY_TYPES.includes(type);
}

export function defaultPreference(type: NotificationType): ResolvedPreference {
  const enabled = !DEFAULT_OFF.includes(type);
  return {
    type,
    inApp: enabled,
    email: enabled,
    push: enabled,
    canDisable: !isSecurityType(type),
  };
}

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Effective preference for one type. Explicitly stored rows win over the
   * defaults; security and marketing defaults are applied in code so new
   * users need no rows at all.
   */
  async resolve(
    userId: string,
    type: NotificationType,
  ): Promise<ResolvedPreference> {
    const stored = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });

    const fallback = defaultPreference(type);

    if (isSecurityType(type)) {
      // Stored values are ignored: security types are always on.
      return { ...fallback, canDisable: false };
    }

    if (!stored) {
      return fallback;
    }

    return {
      type,
      inApp: stored.inApp,
      email: stored.email,
      push: stored.push,
      canDisable: true,
    };
  }

  /** All types, with defaults filled in for anything never saved. */
  async findAll(userId: string): Promise<ResolvedPreference[]> {
    return Promise.all(
      ALL_NOTIFICATION_TYPES.map((type) => this.resolve(userId, type)),
    );
  }

  async update(
    userId: string,
    items: PreferenceItemDto[],
  ): Promise<ResolvedPreference[]> {
    // A security type may be present in the payload but must stay enabled on
    // every channel. Rejecting the whole request (422) is clearer than
    // silently ignoring the attempt.
    const blocked = items.filter(
      (item) =>
        isSecurityType(item.type) &&
        (item.inApp === false || item.email === false || item.push === false),
    );

    if (blocked.length > 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'SECURITY_NOTIFICATION_REQUIRED',
        message: `Security notification types cannot be disabled: ${blocked
          .map((item) => item.type)
          .join(', ')}`,
      });
    }

    const writes = items
      .filter((item) => !isSecurityType(item.type))
      .map((item) => {
        const fallback = defaultPreference(item.type);
        return this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: item.type } },
          create: {
            userId,
            type: item.type,
            inApp: item.inApp ?? fallback.inApp,
            email: item.email ?? fallback.email,
            push: item.push ?? fallback.push,
          },
          update: {
            ...(item.inApp !== undefined && { inApp: item.inApp }),
            ...(item.email !== undefined && { email: item.email }),
            ...(item.push !== undefined && { push: item.push }),
          },
        });
      });

    await this.prisma.$transaction(writes);

    return this.findAll(userId);
  }
}
