import { PrismaClient } from '@prisma/client';

export async function up() {
  const prisma = new PrismaClient();
  try {
    const tableCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT TO_REGCLASS('public.event_logs') AS tbl;
    `);
    if (!tableCheck || !tableCheck[0] || !tableCheck[0].tbl) {
      return;
    }

    const colCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'event_logs' AND column_name = 'sequence_number';
    `);
    if (!colCheck || colCheck.length === 0) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "event_logs" ADD COLUMN IF NOT EXISTS "sequence_number" INTEGER DEFAULT 1;
      `);
    }

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");
    `);
  } finally {
    await prisma.$disconnect();
  }
}
