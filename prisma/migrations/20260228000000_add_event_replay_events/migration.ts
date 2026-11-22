import { PrismaClient } from '@prisma/client';

export async function up() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "event_logs"
      ADD COLUMN IF NOT EXISTS "sequence_number" INTEGER,
      ADD COLUMN IF NOT EXISTS "entity_type" TEXT,
      ADD COLUMN IF NOT EXISTS "actor_id" TEXT,
      ADD COLUMN IF NOT EXISTS "schema_version" INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP(3);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");
    `);
  } finally {
    await prisma.$disconnect();
  }
}
