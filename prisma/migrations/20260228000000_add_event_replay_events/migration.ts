import { PrismaClient } from '@prisma/client';

export async function up(prismaClient?: any) {
  const prisma = prismaClient || new PrismaClient();
  try {
    // Check if event_logs table exists and has sequence_number column before running raw queries
    const tableCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'event_logs';
    `);

    if (tableCheck.length > 0) {
      const colCheck: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'event_logs' AND column_name = 'sequence_number';
      `);

      if (colCheck.length > 0) {
        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");
        `);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
