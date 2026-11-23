import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEntityType, EventLog } from '@prisma/client';

type JsonObject = Record<string, unknown>;

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

/** Maps EventType strings to { from, to } status transitions. */
const TRANSITION_MAP: Record<string, { from: string; to: string }> = {
  ADOPTION_REQUESTED:  { from: '', to: 'REQUESTED' },
  ADOPTION_APPROVED:   { from: 'REQUESTED', to: 'APPROVED' },
  ADOPTION_REJECTED:   { from: 'REQUESTED', to: 'REJECTED' },
  ADOPTION_CANCELLED:  { from: '*', to: 'CANCELLED' },
  ADOPTION_COMPLETED:  { from: 'ESCROW_FUNDED', to: 'COMPLETED' },
  ESCROW_CREATED:      { from: '', to: 'CREATED' },
  ESCROW_FUNDED:       { from: 'CREATED', to: 'FUNDED' },
  ESCROW_RELEASED:     { from: 'FUNDED', to: 'RELEASED' },
  ESCROW_REFUNDED:     { from: '*', to: 'REFUNDED' },
  CUSTODY_CREATED:     { from: '', to: 'ACTIVE' },
  CUSTODY_COMPLETED:   { from: 'ACTIVE', to: 'COMPLETED' },
  CUSTODY_RETURNED:    { from: 'ACTIVE', to: 'RETURNED' },
  CUSTODY_CANCELLED:   { from: '*', to: 'CANCELLED' },
  CUSTODY_VIOLATION:   { from: 'ACTIVE', to: 'VIOLATION' },
  DISPUTE_OPENED:      { from: '', to: 'OPEN' },
  DISPUTE_ASSIGNED:    { from: 'OPEN', to: 'UNDER_REVIEW' },
  DISPUTE_RESOLVED:    { from: '*', to: 'RESOLVED' },
  DISPUTE_WITHDRAWN:   { from: '*', to: 'WITHDRAWN' },
};

@Injectable()
export class StatusHistoryProjection {
  private readonly logger = new Logger(StatusHistoryProjection.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Project a single EventLog row into status_history. Idempotent. */
  async project(event: EventLog): Promise<void> {
    const transition = TRANSITION_MAP[String(event.eventType)];
    if (!transition) return;

    const payload = (typeof event.payload === 'object' && event.payload !== null
      ? event.payload
      : {}) as JsonObject;

    const existing = await this.prisma.statusHistory.findFirst({
      where: {
        entityType: event.entityType,
        entityId: event.entityId,
        at: event.createdAt,
        to: transition.to,
      },
    });
    if (existing) return;

    await this.prisma.statusHistory.create({
      data: {
        entityType: event.entityType,
        entityId: event.entityId,
        from: toStr(payload['previousStatus'] ?? transition.from),
        to: toStr(payload['status'] ?? transition.to),
        actorId: event.actorId ?? null,
        reason: toStr(payload['reason'] ?? '').trim() || null,
        at: event.createdAt,
      },
    });
  }

  /**
   * Rebuild the entire status_history projection for one entity from its
   * EventLog rows. Dropping and re-projecting yields identical rows
   * (acceptance criterion from issue #283).
   */
  async rebuild(entityType: EventEntityType, entityId: string): Promise<void> {
    this.logger.log(`Rebuilding status history for ${entityType}:${entityId}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.statusHistory.deleteMany({
        where: { entityType, entityId },
      });

      const events = await tx.eventLog.findMany({
        where: { entityType, entityId },
        orderBy: { createdAt: 'asc' },
      });

      for (const event of events) {
        const transition = TRANSITION_MAP[String(event.eventType)];
        if (!transition) continue;

        const payload = (typeof event.payload === 'object' && event.payload !== null
          ? event.payload
          : {}) as JsonObject;

        await tx.statusHistory.create({
          data: {
            entityType: event.entityType,
            entityId: event.entityId,
            from: toStr(payload['previousStatus'] ?? transition.from),
            to: toStr(payload['status'] ?? transition.to),
            actorId: event.actorId ?? null,
            reason: toStr(payload['reason'] ?? '').trim() || null,
            at: event.createdAt,
          },
        });
      }
    });

    this.logger.log(`Rebuild complete for ${entityType}:${entityId}`);
  }

  /** Timeline query — index-backed via (entity_id, at). */
  async getTimeline(entityType: EventEntityType, entityId: string) {
    return this.prisma.statusHistory.findMany({
      where: { entityType, entityId },
      orderBy: { at: 'asc' },
      select: {
        id: true,
        from: true,
        to: true,
        actorId: true,
        reason: true,
        at: true,
      },
    });
  }
}
