import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface HashableEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string | null;
  createdAt: Date;
  payload: unknown;
}

export function hashEvent(event: HashableEvent): string {
  return sha256(
    canonicalJson({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      actorId: event.actorId,
      occurredAt: event.createdAt.toISOString(),
      payload: event.payload,
    }),
  );
}
