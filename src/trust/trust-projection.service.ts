import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TRUST_SOURCE_EVENT_TYPES,
  TrustEventMapperService,
} from './trust-event-mapper.service';
import { TrustScoreService } from './trust-score.service';

@Injectable()
export class TrustProjectionService {
  private readonly logger = new Logger(TrustProjectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: TrustEventMapperService,
    private readonly scores: TrustScoreService,
  ) {}

  async processSourceEvent(sourceEventId: string): Promise<boolean> {
    const event = await this.prisma.eventLog.findUnique({
      where: { id: sourceEventId },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        eventType: true,
        actorId: true,
        createdAt: true,
        payload: true,
      },
    });
    if (!event || !TRUST_SOURCE_EVENT_TYPES.includes(event.eventType)) {
      return false;
    }

    const mapped = await this.mapper.map(event);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.trustEventSource.create({
          data: { sourceEventId: event.id },
        });

        if (mapped.length > 0) {
          await tx.trustEvent.createMany({
            data: mapped.map((item) => ({
              sourceEventId: event.id,
              subjectUserId: item.subjectUserId,
              type: item.type,
              occurredAt: item.occurredAt,
              weight: item.weight,
              payload: item.payload,
            })),
            skipDuplicates: true,
          });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }

    const subjectIds = Array.from(
      new Set(mapped.map((item) => item.subjectUserId)),
    );
    for (const subjectId of subjectIds) {
      try {
        await this.scores.recomputeUser(subjectId);
      } catch (error) {
        this.logger.error(
          `Unable to recompute trust score for ${subjectId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return true;
  }

  async processPending(limit = 100): Promise<number> {
    const events = await this.prisma.eventLog.findMany({
      where: {
        eventType: { in: TRUST_SOURCE_EVENT_TYPES },
        trustSources: { none: {} },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let processed = 0;
    for (const event of events) {
      if (await this.processSourceEvent(event.id)) processed += 1;
    }
    return processed;
  }

  async processAll(batchSize = 100): Promise<number> {
    let total = 0;
    for (;;) {
      const processed = await this.processPending(batchSize);
      total += processed;
      if (processed < batchSize) return total;
    }
  }

  async replay() {
    return this.scores.recomputeAll({ force: true });
  }

  async verifyCache() {
    return this.scores.recomputeAll({ force: false });
  }
}
