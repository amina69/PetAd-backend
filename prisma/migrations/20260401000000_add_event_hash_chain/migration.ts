import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

function canonicalJSON(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined) {
      parts.push(JSON.stringify(k) + ':' + canonicalJSON(v));
    }
  }
  return '{' + parts.join(',') + '}';
}

export async function up() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "EventLedger"
      ADD COLUMN IF NOT EXISTS "prevHash" TEXT,
      ADD COLUMN IF NOT EXISTS "eventHash" TEXT;
    `);

    const events: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "entity_id", COALESCE("sequence_number", 1) as "sequenceNumber", type, event_type, payload, actor_id, schema_version, occurred_at, "createdAt"
      FROM "event_logs"
      ORDER BY "entity_id" ASC, "sequence_number" ASC;
    `);

    const latestHashes: Record<string, string | null> = {};

    for (const ev of events) {
      const aggregate = ev.entityId;
      const prevHash = latestHashes[aggregate] ?? null;
      const seq = ev.sequenceNumber;
      const type = ev.eventType || ev.type;
      const payload = ev.payload;
      const actor = ev.actorId;
      const schemaVersion = ev.schemaVersion || 1;
      const occurredAt = ev.occurredAt || ev.createdAt;

      const canonicalObj = {
        aggregate,
        seq,
        type,
        payload,
        actor,
        schemaVersion,
        occurredAt,
        prevHash,
      };

      const canonicalStr = canonicalJSON(canonicalObj);
      const eventHash = crypto.createHash('sha256').update(canonicalStr).digest('hex');

      await prisma.$executeRawUnsafe(
        `UPDATE "EventLedger" SET "prevHash" = $1, "eventHash" = $2 WHERE id = $3`,
        prevHash,
        eventHash,
        ev.id,
      );

      latestHashes[aggregate] = eventHash;
    }
  } finally {
    await prisma.$disconnect();
  }
}
