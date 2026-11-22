import { PrismaClient } from '@prisma/client';

export async function up() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");
    `);
  } catch (error) {
    // If sequence_number does not exist or index already exists, handle gracefully
    console.warn('Migration step warning:', error);
  } finally {
    await prisma.$disconnect();
  }
}
