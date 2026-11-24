import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationAudience,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { PushService } from './push/push.service';
import { NOTIFICATION_RULES, NotificationRule } from './notification-rules';
import { NotificationTemplateService } from './templates/notification-template.service';

export interface DomainEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId?: string | null;
  payload: unknown;
  createdAt?: Date;
}

interface UserRef {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface Recipient {
  id: string;
  email?: string | null;
  name: string;
}

interface EventContext {
  event: DomainEvent;
  payload: Record<string, unknown>;
  actor?: UserRef | null;
  entityUser?: UserRef | null;
  pet?: { id: string; name: string; currentOwner?: UserRef | null } | null;
  adoption?: {
    id: string;
    adopter?: UserRef | null;
    owner?: UserRef | null;
    pet?: { id: string; name: string } | null;
  } | null;
  custody?: {
    id: string;
    holder?: UserRef | null;
    pet?: {
      id: string;
      name: string;
      currentOwner?: UserRef | null;
    } | null;
  } | null;
  escrow?: {
    id: string;
    adoption?: {
      id: string;
      adopter?: UserRef | null;
      owner?: UserRef | null;
      pet?: { id: string; name: string } | null;
    } | null;
    custody?: {
      id: string;
      holder?: UserRef | null;
      pet?: {
        id: string;
        name: string;
        currentOwner?: UserRef | null;
      } | null;
    } | null;
  } | null;
}

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

@Injectable()
export class NotificationMapperService {
  private readonly logger = new Logger(NotificationMapperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: NotificationTemplateService,
    private readonly pushService: PushService,
    private readonly queueService: NotificationQueueService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /**
   * Maps one domain event to notifications for every matching rule.
   *
   * The `(eventId, userId, channel)` unique key makes this idempotent:
   * replaying the same event creates nothing new.
   */
  async handleEvent(event: DomainEvent): Promise<number> {
    const rules = NOTIFICATION_RULES[event.eventType] ?? [];
    if (rules.length === 0) {
      return 0;
    }

    const context = await this.loadContext(event);
    let created = 0;

    for (const rule of rules) {
      const recipients = await this.resolveRecipients(rule.audience, context);
      if (recipients.length === 0) {
        continue;
      }

      for (const recipient of recipients) {
        for (const channel of rule.channels) {
          const didCreate = await this.createAndDispatch(
            rule,
            channel,
            recipient,
            context,
          );
          if (didCreate) {
            created += 1;
          }
        }
      }
    }

    return created;
  }

  private async createAndDispatch(
    rule: NotificationRule,
    channel: NotificationChannel,
    recipient: Recipient,
    context: EventContext,
  ): Promise<boolean> {
    if (channel === NotificationChannel.EMAIL && !recipient.email) {
      return false;
    }

    // Push is reserved for high-priority notifications; every other
    // channel stays quiet so a phone only buzzes for things that matter.
    if (channel === NotificationChannel.PUSH && rule.priority !== 'HIGH') {
      return false;
    }

    const dedupeKey = `${context.event.id}:${recipient.id}:${channel}`;
    const rendered = this.templates.render(rule.template, {
      ...this.templateContext(context, recipient),
    });

    let notification: { id: string };
    try {
      notification = await this.prisma.notification.create({
        data: {
          eventId: context.event.id,
          eventType: context.event.eventType,
          userId: recipient.id,
          audience: rule.audience as NotificationAudience,
          channel: channel,
          priority: rule.priority as NotificationPriority,
          status: NotificationStatus.PENDING,
          template: rule.template,
          title: rendered.subject,
          body: rendered.message,
          route: rendered.route,
          dedupeKey,
        },
        select: { id: true },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        // Replayed event (or duplicate rule): already delivered/enqueued.
        return false;
      }
      throw error;
    }

    await this.dispatch(notification.id, channel, recipient, rendered, context);
    return true;
  }

  private async dispatch(
    notificationId: string,
    channel: NotificationChannel,
    recipient: Recipient,
    rendered: { subject: string; message: string; route?: string },
    context: EventContext,
  ): Promise<void> {
    try {
      if (channel === NotificationChannel.EMAIL) {
        await this.queueService.enqueueSendTransactionalEmail(
          {
            dto: {
              to: recipient.email as string,
              subject: rendered.subject,
              template: 'notification',
              category: 'transactional',
              context: {
                subject: rendered.subject,
                heading: rendered.subject,
                message: rendered.message,
                ...(rendered.route
                  ? {
                      actionUrl: this.absoluteUrl(rendered.route),
                      actionLabel: 'View details',
                    }
                  : {}),
              },
            },
            metadata: {
              notificationId,
              eventId: context.event.id,
            },
          },
          { jobId: `email:${notificationId}` },
        );
        return;
      }

      if (channel === NotificationChannel.PUSH) {
        const result = await this.pushService.sendToUser(recipient.id, {
          title: rendered.subject,
          body: rendered.message,
          route: rendered.route,
        });
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status:
              result.sent > 0
                ? NotificationStatus.SENT
                : NotificationStatus.SKIPPED,
            sentAt: result.sent > 0 ? new Date() : null,
            error:
              result.sent === 0 && !result.skipped
                ? 'No push subscription accepted the payload'
                : null,
          },
        });
        return;
      }

      // In-app: the row itself is the delivery.
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to dispatch ${channel} notification ${notificationId}: ${reason}`,
      );
      await this.prisma.notification
        .update({
          where: { id: notificationId },
          data: { status: NotificationStatus.FAILED, error: reason },
        })
        .catch(() => undefined);
    }
  }

  private async resolveRecipients(
    audience: NotificationRule['audience'],
    context: EventContext,
  ): Promise<Recipient[]> {
    const adoption = context.adoption ?? context.escrow?.adoption ?? null;
    const custody = context.custody ?? context.escrow?.custody ?? null;
    const petOwner =
      context.pet?.currentOwner ?? custody?.pet?.currentOwner ?? null;

    switch (audience) {
      case 'ADOPTER':
        return this.compact([adoption?.adopter]);
      case 'OWNER':
        return this.compact([adoption?.owner, petOwner]);
      case 'HOLDER':
        return this.compact([custody?.holder]);
      case 'ACTOR':
        return this.compact([context.actor]);
      case 'COUNTERPARTY':
        return this.compact([this.counterparty(context, adoption, custody)]);
      case 'ADMINS': {
        const admins = await this.prisma.user.findMany({
          where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
          select: userSelect,
        });
        return this.compact(admins);
      }
      default:
        return [];
    }
  }

  private counterparty(
    context: EventContext,
    adoption: EventContext['adoption'],
    custody: EventContext['custody'],
  ): UserRef | null {
    const actorId = context.event.actorId;

    if (adoption) {
      if (actorId === adoption.adopter?.id) {
        return adoption.owner ?? null;
      }
      if (actorId === adoption.owner?.id) {
        return adoption.adopter ?? null;
      }
    }

    const holder = custody?.holder ?? null;
    const owner = custody?.pet?.currentOwner ?? null;
    if (actorId === holder?.id) {
      return owner;
    }
    if (actorId === owner?.id) {
      return holder;
    }

    return null;
  }

  private compact(users: Array<UserRef | null | undefined>): Recipient[] {
    const seen = new Set<string>();
    const recipients: Recipient[] = [];

    for (const user of users) {
      if (!user || seen.has(user.id)) {
        continue;
      }
      seen.add(user.id);
      recipients.push({
        id: user.id,
        email: user.email ?? undefined,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there',
      });
    }

    return recipients;
  }

  private templateContext(
    context: EventContext,
    recipient: Recipient,
  ): Record<string, unknown> {
    const adoption = context.adoption ?? context.escrow?.adoption ?? null;
    const custody = context.custody ?? context.escrow?.custody ?? null;
    const pet = context.pet ?? adoption?.pet ?? custody?.pet ?? null;

    return {
      eventId: context.event.id,
      eventType: context.event.eventType,
      petId: pet?.id ?? '',
      petName: pet?.name ?? 'your pet',
      adoptionId: adoption?.id ?? '',
      custodyId: custody?.id ?? '',
      escrowId: context.escrow?.id ?? '',
      recipientName: recipient.name,
      adopterName: this.displayName(adoption?.adopter) ?? 'The adopter',
      ownerName:
        this.displayName(adoption?.owner ?? custody?.pet?.currentOwner) ??
        'The owner',
      holderName: this.displayName(custody?.holder) ?? 'The custodian',
      actorName: this.displayName(context.actor) ?? 'PetAd',
    };
  }

  private displayName(user?: UserRef | null): string | undefined {
    if (!user) {
      return undefined;
    }
    return (
      [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined
    );
  }

  private async loadContext(event: DomainEvent): Promise<EventContext> {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};

    const context: EventContext = { event, payload };

    const entityType = String(event.entityType).toUpperCase();

    if (entityType === 'ADOPTION') {
      context.adoption = await this.prisma.adoption.findUnique({
        where: { id: event.entityId },
        include: {
          adopter: { select: userSelect },
          owner: { select: userSelect },
          pet: { select: { id: true, name: true } },
        },
      });
    } else if (entityType === 'CUSTODY') {
      context.custody = await this.prisma.custody.findUnique({
        where: { id: event.entityId },
        include: {
          holder: { select: userSelect },
          pet: {
            select: {
              id: true,
              name: true,
              currentOwner: { select: userSelect },
            },
          },
        },
      });
    } else if (entityType === 'ESCROW') {
      context.escrow = await this.prisma.escrow.findUnique({
        where: { id: event.entityId },
        include: {
          adoption: {
            include: {
              adopter: { select: userSelect },
              owner: { select: userSelect },
              pet: { select: { id: true, name: true } },
            },
          },
          custody: {
            include: {
              holder: { select: userSelect },
              pet: {
                select: {
                  id: true,
                  name: true,
                  currentOwner: { select: userSelect },
                },
              },
            },
          },
        },
      });
    } else if (entityType === 'PET') {
      context.pet = await this.prisma.pet.findUnique({
        where: { id: event.entityId },
        select: {
          id: true,
          name: true,
          currentOwner: { select: userSelect },
        },
      });
    } else if (entityType === 'USER') {
      context.entityUser = await this.prisma.user.findUnique({
        where: { id: event.entityId },
        select: userSelect,
      });
    }

    if (event.actorId) {
      context.actor = await this.prisma.user.findUnique({
        where: { id: event.actorId },
        select: userSelect,
      });
    }

    // Some events reference the adoption/custody only in their payload.
    if (!context.adoption && typeof payload.adoptionId === 'string') {
      context.adoption = await this.prisma.adoption.findUnique({
        where: { id: payload.adoptionId },
        include: {
          adopter: { select: userSelect },
          owner: { select: userSelect },
          pet: { select: { id: true, name: true } },
        },
      });
    }

    if (!context.custody && typeof payload.custodyId === 'string') {
      context.custody = await this.prisma.custody.findUnique({
        where: { id: payload.custodyId },
        include: {
          holder: { select: userSelect },
          pet: {
            select: {
              id: true,
              name: true,
              currentOwner: { select: userSelect },
            },
          },
        },
      });
    }

    if (!context.pet && typeof payload.petId === 'string') {
      context.pet = await this.prisma.pet.findUnique({
        where: { id: payload.petId },
        select: {
          id: true,
          name: true,
          currentOwner: { select: userSelect },
        },
      });
    }

    return context;
  }

  private absoluteUrl(route: string): string {
    const base =
      this.configService?.get<string>('FRONTEND_URL') ??
      this.configService?.get<string>('APP_BASE_URL') ??
      '';
    if (!route) {
      return base;
    }
    if (/^https?:\/\//i.test(route)) {
      return route;
    }
    return `${base.replace(/\/$/, '')}${route.startsWith('/') ? '' : '/'}${route}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
