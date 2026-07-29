import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventType, Prisma } from '@prisma/client';

export interface MovementTimelineEvent {
  eventType: string;
  summary: string;
  occurredAt: string;
  stellarTxHash?: string;
  anchorStatus: string;
}

export interface MovementHistoryOptions {
  page?: number;
  limit?: number;
  sort?: 'asc' | 'desc';
}

export interface PetMovementHistory {
  petId: string;
  petName: string;
  timeline: MovementTimelineEvent[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Maps EventType to a human-readable summary prefix.
 */
const EVENT_SUMMARIES: Partial<Record<EventType, string>> = {
  CUSTODY_STARTED: 'Custody started',
  CUSTODY_RETURNED: 'Custody returned',
  CUSTODY_VIOLATION: 'Custody violation reported',
  CUSTODY_CANCELLED: 'Custody cancelled',
  PET_CUSTODY_CANCELLED: 'Custody cancelled',
  ADOPTION_REQUESTED: 'Adoption requested',
  ADOPTION_APPROVED: 'Adoption approved',
  ADOPTION_COMPLETED: 'Adoption completed',
  PET_REGISTERED: 'Pet registered',
};

@Injectable()
export class PetMovementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the paginated and sorted movement history of a pet.
   *
   * @param petId - The pet's unique ID
   * @param options - Pagination & sorting options (page, limit, sort)
   * @returns Paginated movement history with timeline and metadata
   */
  async getMovementHistory(
    petId: string,
    options: MovementHistoryOptions = {},
  ): Promise<PetMovementHistory> {
    const { page = 1, limit = 20, sort = 'asc' } = options;

    // Verify the pet exists
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      select: { id: true, name: true },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with ID ${petId} not found`);
    }

    const orderBy: { createdAt: 'asc' | 'desc' } = {
      createdAt: sort,
    };

    const whereClause = {
      OR: [
        { entityType: 'PET' as const, entityId: petId },
        {
          payload: {
            path: ['petId'],
            string_contains: petId,
          } as Prisma.JsonFilter,
        },
      ],
    };

    // Fetch total count and paginated events in parallel
    const skip = (page - 1) * limit;
    const [total, events] = await Promise.all([
      this.prisma.eventLog.count({
        where: whereClause,
      }),
      this.prisma.eventLog.findMany({
        where: whereClause,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    const timeline: MovementTimelineEvent[] = events.map((event) => ({
      eventType: event.eventType,
      summary: this.buildSummary(event),
      occurredAt: event.createdAt.toISOString(),
      stellarTxHash: event.txHash ?? undefined,
      anchorStatus: event.txHash ? 'ANCHORED' : 'PENDING',
    }));

    return {
      petId: pet.id,
      petName: pet.name,
      timeline,
      total,
      page,
      limit,
    };
  }

  private buildSummary(event: {
    eventType: string;
    payload: Prisma.JsonValue;
  }): string {
    const prefix = EVENT_SUMMARIES[event.eventType as EventType] ?? event.eventType;

    // Try to extract additional context from payload
    const payload = event.payload as Record<string, unknown> | null;
    if (payload?.reason) {
      return `${prefix} — ${String(payload.reason)}`;
    }

    return prefix;
  }
}
