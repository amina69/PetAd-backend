import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEntityType, EventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';
import { SanitisedValue, sanitiseAuditMetadata } from '../audit-log.sanitizer';

const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 25;

export interface AuditLogEntryView {
  id: string;
  source: 'EVENT' | 'APP';
  actor: { id: string; displayName: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  requestId: string | null;
  level: string | null;
  message: string | null;
  metadata: SanitisedValue;
  createdAt: string;
}

export interface AuditLogPageView {
  from: string;
  to: string;
  limit: number;
  nextCursor: string | null;
  data: AuditLogEntryView[];
}

interface AuditCursor {
  createdAt: Date;
  id: string;
}

interface RawEntry {
  id: string;
  source: 'EVENT' | 'APP';
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  requestId: string | null;
  level: string | null;
  message: string | null;
  metadata: SanitisedValue;
  createdAt: Date;
}

interface QueryContext {
  userId?: string;
  requestId?: string;
}

@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  async query(
    dto: AuditLogQueryDto,
    context: QueryContext = {},
  ): Promise<AuditLogPageView> {
    const { from, to } = this.resolveRange(dto);
    const limit = dto.limit ?? DEFAULT_LIMIT;
    const cursor = this.decodeCursor(dto.cursor);

    const eventsAllowed =
      !dto.action ||
      (Object.values(EventType) as string[]).includes(dto.action);
    const eventEntityAllowed =
      !dto.entityType ||
      (Object.values(EventEntityType) as string[]).includes(dto.entityType);

    const eventWhere: Prisma.EventLogWhereInput = {
      createdAt: { gte: from, lte: to },
    };
    if (dto.actorId) {
      eventWhere.actorId = dto.actorId;
    }
    if (dto.action && eventsAllowed) {
      eventWhere.eventType = dto.action as EventType;
    }
    if (dto.entityType && eventEntityAllowed) {
      eventWhere.entityType = dto.entityType as EventEntityType;
    }
    if (cursor) {
      eventWhere.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const appWhere: Prisma.AppLogWhereInput = {
      createdAt: { gte: from, lte: to },
    };
    if (dto.actorId) {
      appWhere.userId = dto.actorId;
    }
    if (dto.action) {
      appWhere.action = dto.action;
    }
    if (dto.entityType) {
      appWhere.metadata = {
        path: ['entityType'],
        equals: dto.entityType,
      };
    }
    if (cursor) {
      appWhere.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const [events, appLogs] = await Promise.all([
      eventsAllowed && eventEntityAllowed
        ? this.prisma.eventLog.findMany({
            where: eventWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
          })
        : Promise.resolve([]),
      this.prisma.appLog.findMany({
        where: appWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);

    const merged: RawEntry[] = [
      ...events.map((event) => this.mapEvent(event)),
      ...appLogs.map((log) => this.mapAppLog(log)),
    ].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );

    const hasMore = merged.length > limit;
    const page = hasMore ? merged.slice(0, limit) : merged;

    const actors = await this.loadActors(page);
    const data: AuditLogEntryView[] = page.map((entry) => ({
      id: entry.id,
      source: entry.source,
      actor: entry.actorId
        ? {
            id: entry.actorId,
            displayName: actors.get(entry.actorId) ?? 'Deleted user',
          }
        : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      requestId: entry.requestId,
      level: entry.level,
      message: entry.message,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    }));

    const nextCursor =
      hasMore && page.length > 0
        ? this.encodeCursor(page[page.length - 1])
        : null;

    // Accessing the audit log is itself an auditable event.
    await this.loggingService.log({
      level: 'INFO',
      action: 'AUDIT_LOG_ACCESSED',
      message: `Audit log queried (${data.length} entries)`,
      userId: context.userId,
      metadata: {
        requestId: context.requestId ?? null,
        from: from.toISOString(),
        to: to.toISOString(),
        limit,
        actorId: dto.actorId ?? null,
        action: dto.action ?? null,
        entityType: dto.entityType ?? null,
        cursor: dto.cursor ?? null,
        returned: data.length,
      },
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      limit,
      nextCursor,
      data,
    };
  }

  // ─── Mapping ───────────────────────────────────────────────────────────

  private mapEvent(event: {
    id: string;
    actorId: string | null;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Prisma.JsonValue;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  }): RawEntry {
    const metadata = asRecord(event.metadata);

    return {
      id: event.id,
      source: 'EVENT',
      actorId: event.actorId,
      action: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      requestId: stringOrNull(metadata?.requestId),
      level: null,
      message: null,
      metadata: sanitiseAuditMetadata({
        payload: event.payload,
        ...(metadata ?? {}),
      }),
      createdAt: event.createdAt,
    };
  }

  private mapAppLog(log: {
    id: string;
    userId: string | null;
    level: string;
    action: string;
    message: string;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  }): RawEntry {
    const metadata = asRecord(log.metadata);

    return {
      id: log.id,
      source: 'APP',
      actorId: log.userId,
      action: log.action,
      entityType: stringOrNull(metadata?.entityType),
      entityId: stringOrNull(metadata?.entityId),
      requestId: stringOrNull(metadata?.requestId),
      level: log.level,
      message: log.message,
      metadata: sanitiseAuditMetadata(metadata ?? {}),
      createdAt: log.createdAt,
    };
  }

  private async loadActors(entries: RawEntry[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        entries
          .map((entry) => entry.actorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (ids.length === 0) {
      return new Map();
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    return new Map(
      users.map((user) => {
        const name = [user.firstName, user.lastName]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(' ')
          .trim();
        return [user.id, name.length > 0 ? name : user.email];
      }),
    );
  }

  // ─── Range & cursor ────────────────────────────────────────────────────

  private resolveRange(dto: AuditLogQueryDto): { from: Date; to: Date } {
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from
      ? new Date(dto.from)
      : new Date(to.getTime() - MAX_RANGE_MS);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('`from` must be before `to`');
    }

    const span = to.getTime() - from.getTime();
    if (span > MAX_RANGE_MS && (!dto.from || !dto.to)) {
      throw new BadRequestException(
        'A date range longer than 90 days requires both `from` and `to` to be supplied',
      );
    }

    return { from, to };
  }

  private encodeCursor(entry: RawEntry): string {
    return Buffer.from(
      JSON.stringify({
        t: entry.createdAt.toISOString(),
        id: entry.id,
        s: entry.source,
      }),
    ).toString('base64url');
  }

  private decodeCursor(cursor?: string): AuditCursor | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { t?: unknown; id?: unknown };

      if (typeof parsed.t !== 'string' || typeof parsed.id !== 'string') {
        throw new Error('Malformed cursor');
      }

      const createdAt = new Date(parsed.t);
      if (Number.isNaN(createdAt.getTime())) {
        throw new Error('Malformed cursor date');
      }

      return { createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}

function asRecord(
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
