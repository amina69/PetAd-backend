import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventType, Prisma } from '@prisma/client';

export interface MovementTimelineEvent {
  eventType: string;
  summary: string;
  occurredAt: string;
  stellarTxHash?: string;
  anchorStatus: string;
  anchorBatch?: string;
  eventId: string;
}

export interface CustodyHop {
  hopIndex: number;
  fromRole?: string;
  fromUserId?: string;
  fromName?: string;
  toRole: string;
  toUserId: string;
  toName?: string;
  startDate: string;
  endDate?: string;
  eventId: string;
  anchorBatch?: string;
  stellarTxHash?: string;
  anchorStatus: string;
}

export interface CustodyAnomaly {
  type: 'OVERLAP' | 'GAP';
  description: string;
  hopIndex1: number;
  hopIndex2?: number;
  details: string;
}

export interface PetMovementHistory {
  petId: string;
  petName: string;
  verifiedChain: boolean;
  anomalyCount: number;
  anomalies: CustodyAnomaly[];
  custodyChain: CustodyHop[];
  timeline: MovementTimelineEvent[];
}

export interface PublicPetMovementHistory {
  petId: string;
  petName: string;
  verifiedChain: boolean;
  hopCount: number;
  anomalyCount: number;
  hasAnomalies: boolean;
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

  async getMovementHistory(
    petId: string,
    format: 'json' | 'csv' = 'json',
    user?: { userId?: string; role?: string },
  ): Promise<PetMovementHistory | PublicPetMovementHistory | string> {
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      select: { id: true, name: true, currentOwnerId: true },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with ID ${petId} not found`);
    }

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

    // Access control
    const role = user?.role;
    const userId = user?.userId;
    const isAdmin = role === 'ADMIN';
    const isCurrentOwner = userId && pet.currentOwnerId === userId;

    let isParty = false;
    if (userId && !isAdmin && !isCurrentOwner) {
      for (const ev of events) {
        const p = ev.payload as Record<string, unknown> | null;
        if (
          p &&
          (p.adopterId === userId ||
            p.ownerId === userId ||
            p.holderId === userId ||
            p.userId === userId)
        ) {
          isParty = true;
          break;
        }
      }
    }

    const fullAccess = isAdmin || isCurrentOwner || isParty;

    const timeline: MovementTimelineEvent[] = events.map((event) => {
      const payloadObj = event.payload as Record<string, unknown> | null;
      const anchorBatch =
        payloadObj && typeof payloadObj.anchorBatch === 'string'
          ? payloadObj.anchorBatch
          : event.txHash
            ? `batch-${event.txHash.substring(0, 8)}`
            : undefined;

      return {
        eventType: event.eventType,
        summary: this.buildSummary(event),
        occurredAt: event.createdAt.toISOString(),
        stellarTxHash: event.txHash ?? undefined,
        anchorStatus: event.txHash ? 'ANCHORED' : 'PENDING',
        anchorBatch,
        eventId: event.id,
      };
    });

    const custodyChain = this.buildCustodyChain(events);
    const anomalies = this.detectAnomalies(custodyChain);
    const verifiedChain = anomalies.length === 0 && custodyChain.length > 0;

    if (!fullAccess) {
      const publicView: PublicPetMovementHistory = {
        petId: pet.id,
        petName: pet.name,
        verifiedChain,
        hopCount: custodyChain.length,
        anomalyCount: anomalies.length,
        hasAnomalies: anomalies.length > 0,
      };
      if (format === 'csv') {
        return this.convertToCsv(null, [publicView], true);
      }
      return publicView;
    }

    const fullHistory: PetMovementHistory = {
      petId: pet.id,
      petName: pet.name,
      verifiedChain,
      anomalyCount: anomalies.length,
      anomalies,
      custodyChain,
      timeline,
    };

    if (format === 'csv') {
      return this.convertToCsv(fullHistory, [], false);
    }

    return fullHistory;
  }

  private buildCustodyChain(events: any[]): CustodyHop[] {
    const chain: CustodyHop[] = [];
    let hopIndex = 0;

    for (const event of events) {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const eventType = event.eventType;

      if (
        eventType === EventType.CUSTODY_STARTED ||
        eventType === EventType.ADOPTION_COMPLETED ||
        eventType === EventType.PET_REGISTERED
      ) {
        const anchorBatch = typeof payload.anchorBatch === 'string' ? payload.anchorBatch : event.txHash ? `batch-${event.txHash.substring(0, 8)}` : undefined;
        
        let toRole = 'SHELTER';
        if (eventType === EventType.CUSTODY_STARTED) toRole = 'TEMPORARY_HOLDER';
        if (eventType === EventType.ADOPTION_COMPLETED) toRole = 'ADOPTER';

        const toUserId = String(
          payload.holderId ||
            payload.adopterId ||
            payload.ownerId ||
            payload.userId ||
            event.actorId ||
            'unknown',
        );

        chain.push({
          hopIndex: hopIndex++,
          toRole,
          toUserId,
          startDate: event.createdAt.toISOString(),
          eventId: event.id,
          anchorBatch,
          stellarTxHash: event.txHash ?? undefined,
          anchorStatus: event.txHash ? 'ANCHORED' : 'PENDING',
        });
      } else if (
        eventType === EventType.CUSTODY_RETURNED ||
        eventType === EventType.CUSTODY_CANCELLED ||
        eventType === EventType.CUSTODY_VIOLATION
      ) {
        if (chain.length > 0) {
          const lastHop = chain[chain.length - 1];
          if (!lastHop.endDate) {
            lastHop.endDate = event.createdAt.toISOString();
          }
        }
      }
    }

    return chain;
  }

  private detectAnomalies(chain: CustodyHop[]): CustodyAnomaly[] {
    const anomalies: CustodyAnomaly[] = [];

    for (let i = 0; i < chain.length; i++) {
      const hop1 = chain[i];
      const start1 = new Date(hop1.startDate).getTime();
      const end1 = hop1.endDate ? new Date(hop1.endDate).getTime() : null;

      for (let j = i + 1; j < chain.length; j++) {
        const hop2 = chain[j];
        const start2 = new Date(hop2.startDate).getTime();

        if (end1 === null || end1 > start2) {
          if (hop1.toUserId !== hop2.toUserId) {
            anomalies.push({
              type: 'OVERLAP',
              description: `Custody period overlap detected between hop ${hop1.hopIndex} and hop ${hop2.hopIndex}`,
              hopIndex1: hop1.hopIndex,
              hopIndex2: hop2.hopIndex,
              details: `Pet is recorded in two places simultaneously (${hop1.toUserId} and ${hop2.toUserId})`,
            });
          }
        }
      }
    }

    return anomalies;
  }

  private convertToCsv(
    history: PetMovementHistory | null,
    publicViews: PublicPetMovementHistory[],
    isPublic: boolean,
  ): string {
    if (isPublic && publicViews.length > 0) {
      const pv = publicViews[0];
      return 'petId,petName,verifiedChain,hopCount,anomalyCount,hasAnomalies\n' +
        `"${pv.petId}","${pv.petName}",${pv.verifiedChain},${pv.hopCount},${pv.anomalyCount},${pv.hasAnomalies}`;
    }

    if (!history) return '';

    const rows: string[] = [];
    rows.push('hopIndex,toRole,toUserId,startDate,endDate,anchorStatus,anchorBatch,stellarTxHash,eventId');
    for (const hop of history.custodyChain) {
      rows.push(
        `${hop.hopIndex},${hop.toRole},${hop.toUserId},${hop.startDate},${hop.endDate || ''},${hop.anchorStatus},${hop.anchorBatch || ''},${hop.stellarTxHash || ''},${hop.eventId}`,
      );
    }
    return rows.join('\n');
  }

  private buildSummary(event: {
    eventType: string;
    payload: Prisma.JsonValue;
  }): string {
    const prefix = EVENT_SUMMARIES[event.eventType as EventType] ?? event.eventType;
    const payload = event.payload as Record<string, unknown> | null;
    if (payload?.reason) {
      return `${prefix} — ${String(payload.reason)}`;
    }
    return prefix;
  }
}
