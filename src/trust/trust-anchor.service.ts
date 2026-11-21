import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AnchorRow {
  eventId: string;
  anchorBatchId: string | null;
}

@Injectable()
export class TrustAnchorService {
  private readonly logger = new Logger(TrustAnchorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async latestAnchorBatch(eventIds: readonly string[]): Promise<string | null> {
    const batches = await this.latestAnchorBatchForEvents(eventIds);
    const values = Array.from(batches.values()).sort();
    return values.length === 0 ? null : values[values.length - 1];
  }

  async latestAnchorBatchForEvents(
    eventIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (eventIds.length === 0) return new Map();

    try {
      const rows = await this.prisma.$queryRaw<AnchorRow[]>`
        SELECT "id"::text AS "eventId", "anchorBatchId"
        FROM "EventLedger"
        WHERE "id" IN (${Prisma.join([...eventIds])})
          AND "anchorBatchId" IS NOT NULL
      `;
      const batches = new Map<string, string>();
      for (const row of rows) {
        if (row.anchorBatchId) {
          batches.set(row.eventId, row.anchorBatchId);
        }
      }
      return batches;
    } catch (error) {
      this.logger.warn(
        `Unable to read anchor metadata: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }
}
