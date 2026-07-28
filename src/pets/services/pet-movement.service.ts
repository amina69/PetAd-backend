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

export interface PetMovementHistory {
  petId: string;
  petName: string;
  timeline: MovementTimelineEvent[];
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
   * Returns the complete movement history of a pet — every adoption and custody
   * event in chronological order.
   */
  async getMovementHistory(petId: string): Promise<PetMovementHistory> {
    // Verify the pet exists
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      select: { id: true, name: true },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with ID ${petId} not found`);
    }

    // Query event_logs where:
    //   - entityType = PET and entityId = petId (for PET-scoped events like PET_CUSTODY_CANCELLED)
    //   - OR payload contains the petId (for adoption/custody events)
    const events = await this.prisma.eventLog.findMany({
      where: {
        OR: [
          { entityType: 'PET', entityId: petId },
          {
            payload: {
              path: ['petId'],
              string_contains: petId,
            } as Prisma.JsonFilter,
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

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
