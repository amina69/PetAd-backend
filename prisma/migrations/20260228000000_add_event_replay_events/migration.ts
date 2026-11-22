import { PrismaClient } from '@prisma/client';

export async function up() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");
    `);
  } catch (e) {
    // If sequence_number does not exist yet or index exists, ignore or handle
  } finally {
    await prisma.$disconnect();
  }
}
