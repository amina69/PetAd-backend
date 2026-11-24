import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

/** Shape returned to the frontend. */
export interface NotificationDto {
  id: string;
  type: Notification['type'];
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  data: NotificationDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface Cursor {
  createdAt: Date;
  id: string;
}

export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.data ?? null,
    isRead: notification.readAt !== null,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    `${cursor.createdAt.toISOString()}|${cursor.id}`,
    'utf8',
  ).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid notification cursor');
  }

  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw new BadRequestException('Invalid notification cursor');
  }

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);

  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new BadRequestException('Invalid notification cursor');
  }

  return { createdAt, id };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cursor-paginated list. Ordering is (createdAt DESC, id DESC) and the
   * cursor encodes both parts, so inserts between pages cannot duplicate or
   * skip a row. Ownership is part of the query itself.
   */
  async findAll(
    userId: string,
    query: ListNotificationsDto = {},
  ): Promise<NotificationPage> {
    const { cursor, limit = 20, unread, type } = query;
    const take = limit;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(unread ? { readAt: null } : {}),
      ...(type ? { type } : {}),
    };

    if (cursor) {
      const decoded = decodeCursor(cursor);
      where.AND = [
        {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        },
      ];
    }

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];

    return {
      data: page.map(toNotificationDto),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  /**
   * Marks one notification read. The update is scoped to the caller, so
   * another user's notification is indistinguishable from a missing one
   * (404). Calling this twice is a no-op and returns the same record.
   */
  async markRead(userId: string, id: string): Promise<NotificationDto> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });

    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // `count === 0` simply means it was already read (or already handled by
    // a concurrent request); the row lookup above is the single source of
    // truth for the response.
    return toNotificationDto(notification);
  }

  /**
   * Marks every unread notification of the caller read in one statement.
   * Returns the number of rows actually changed; already-read rows are
   * untouched by the `readAt: null` predicate.
   */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }
}
