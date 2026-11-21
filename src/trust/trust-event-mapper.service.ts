import { Injectable } from '@nestjs/common';
import {
  EventEntityType,
  EventType,
  Prisma,
  TrustEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const TRUST_SOURCE_EVENT_TYPES: EventType[] = [
  EventType.ADOPTION_COMPLETED,
  EventType.CUSTODY_COMPLETED,
  EventType.CUSTODY_RETURNED,
  EventType.CUSTODY_VIOLATION,
  EventType.REVIEW_CREATED,
  EventType.DISPUTE_OPENED,
  EventType.DISPUTE_RESOLVED_IN_FAVOUR,
  EventType.DISPUTE_RESOLVED_AGAINST,
  EventType.DOCUMENT_VERIFIED,
  EventType.ESCROW_REFUNDED,
];

export interface MappedTrustEvent {
  subjectUserId: string;
  type: TrustEventType;
  weight: number;
  occurredAt: Date;
  payload: Prisma.InputJsonValue;
}

interface SourceEvent {
  id: string;
  entityType: EventEntityType;
  entityId: string;
  eventType: EventType;
  actorId: string | null;
  createdAt: Date;
  payload: Prisma.JsonValue;
}

type JsonObject = Record<string, unknown>;

function asObject(value: Prisma.JsonValue): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

@Injectable()
export class TrustEventMapperService {
  constructor(private readonly prisma: PrismaService) {}

  async map(event: SourceEvent): Promise<MappedTrustEvent[]> {
    const payload = asObject(event.payload);
    const occurredAt = event.createdAt;
    const base = {
      weight: 1,
      occurredAt,
      payload: {
        sourceEventId: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
      } satisfies Prisma.InputJsonValue,
    };

    switch (event.eventType) {
      case EventType.ADOPTION_COMPLETED: {
        const adoptionId = firstString(payload.adoptionId, event.entityId);
        if (!adoptionId) return [];
        const adoption = await this.prisma.adoption.findUnique({
          where: { id: adoptionId },
          select: { adopterId: true, ownerId: true },
        });
        if (!adoption) return [];
        return uniqueStrings([adoption.adopterId, adoption.ownerId]).map(
          (subjectUserId) => ({
            ...base,
            subjectUserId,
            type: TrustEventType.AGREEMENT_COMPLETED,
          }),
        );
      }

      case EventType.CUSTODY_COMPLETED:
      case EventType.CUSTODY_RETURNED:
      case EventType.CUSTODY_VIOLATION: {
        const custodyId = firstString(payload.custodyId, event.entityId);
        if (!custodyId) return [];
        const custody = await this.prisma.custody.findUnique({
          where: { id: custodyId },
          select: { holderId: true },
        });
        if (!custody) return [];
        return [
          {
            ...base,
            subjectUserId: custody.holderId,
            type:
              event.eventType === EventType.CUSTODY_VIOLATION
                ? TrustEventType.VIOLATION
                : TrustEventType.AGREEMENT_COMPLETED,
          },
        ];
      }

      case EventType.REVIEW_CREATED: {
        const subjectUserId = firstString(payload.subjectId, payload.userId);
        const rating = Number(payload.rating);
        if (!subjectUserId || !Number.isFinite(rating)) return [];
        const type =
          rating >= 4
            ? TrustEventType.POSITIVE_REVIEW
            : rating <= 2
              ? TrustEventType.NEGATIVE_REVIEW
              : TrustEventType.NEUTRAL_REVIEW;
        return [{ ...base, subjectUserId, type }];
      }

      case EventType.DISPUTE_OPENED:
      case EventType.DISPUTE_RESOLVED_IN_FAVOUR:
      case EventType.DISPUTE_RESOLVED_AGAINST: {
        const parties = await this.resolveParties(payload, event);
        const type =
          event.eventType === EventType.DISPUTE_OPENED
            ? TrustEventType.DISPUTE_OPENED
            : event.eventType === EventType.DISPUTE_RESOLVED_IN_FAVOUR
              ? TrustEventType.DISPUTE_RESOLVED_IN_FAVOUR
              : TrustEventType.DISPUTE_RESOLVED_AGAINST;
        return parties.map((subjectUserId) => ({
          ...base,
          subjectUserId,
          type,
        }));
      }

      case EventType.DOCUMENT_VERIFIED: {
        const subjectUserId = firstString(
          payload.subjectId,
          payload.userId,
          event.actorId,
        );
        return subjectUserId
          ? [
              {
                ...base,
                subjectUserId,
                type: TrustEventType.DOCUMENT_VERIFIED,
              },
            ]
          : [];
      }

      case EventType.ESCROW_REFUNDED: {
        const disputeReason =
          typeof payload.reason === 'string' ? payload.reason : '';
        const isDispute =
          payload.dispute === true ||
          disputeReason.toUpperCase().includes('DISPUTE');
        if (!isDispute) return [];
        const parties = await this.resolveParties(payload, event);
        return parties.map((subjectUserId) => ({
          ...base,
          subjectUserId,
          type: TrustEventType.DISPUTE_RESOLVED_AGAINST,
        }));
      }

      default:
        return [];
    }
  }

  private async resolveParties(
    payload: JsonObject,
    event: SourceEvent,
  ): Promise<string[]> {
    const explicit = uniqueStrings([
      firstString(payload.subjectId, payload.userId),
      ...(Array.isArray(payload.subjectIds)
        ? payload.subjectIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : []),
    ]);
    if (explicit.length > 0) return explicit;

    const agreementId = firstString(payload.agreementId, event.entityId);
    if (!agreementId) return [];

    if (event.entityType === EventEntityType.ADOPTION) {
      const adoption = await this.prisma.adoption.findUnique({
        where: { id: agreementId },
        select: { adopterId: true, ownerId: true },
      });
      return adoption
        ? uniqueStrings([adoption.adopterId, adoption.ownerId])
        : [];
    }

    if (event.entityType === EventEntityType.CUSTODY) {
      const custody = await this.prisma.custody.findUnique({
        where: { id: agreementId },
        select: { holderId: true, pet: { select: { currentOwnerId: true } } },
      });
      return custody
        ? uniqueStrings([custody.holderId, custody.pet.currentOwnerId])
        : [];
    }

    return [];
  }
}
