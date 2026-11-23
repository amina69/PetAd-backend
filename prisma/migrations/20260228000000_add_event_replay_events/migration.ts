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
      return;
    }

    await prisma.$executeRawUnsafe(`
      -- CreateIndex
      CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");
    `);
  } finally {
    await prisma.$disconnect();
  }
}
