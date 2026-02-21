/* eslint-disable @typescript-eslint/no-unused-vars */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
// import { PrismaClient } from '../generated/prisma/client';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // Clean existing data in reverse dependency order
  await prisma.eventLog.deleteMany();
  await prisma.adoptionRequest.deleteMany();
  await prisma.custodyAgreement.deleteMany();
  await prisma.escrowAccount.deleteMany();
  await prisma.pet.deleteMany();
  await prisma.user.deleteMany();

  // ─── Users ───────────────────────────────────────────────

  const admin = await prisma.user.create({
    data: {
      email: 'admin@petad.org',
      password: '$2b$10$placeholder_hash_admin',
      firstName: 'Platform',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });

  const shelter = await prisma.user.create({
    data: {
      email: 'happypaws@shelter.org',
      password: '$2b$10$placeholder_hash_shelter',
      firstName: 'Happy Paws',
      lastName: 'Shelter',
      role: 'SHELTER',
      stellarPublicKey:
        'GBHAPPY0PAWS0SHELTER0STELLAR0PUBLIC0KEY000000000000000',
    },
  });

  const adopter = await prisma.user.create({
    data: {
      email: 'jane@example.com',
      password: '$2b$10$placeholder_hash_user',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'USER',
      stellarPublicKey:
        'GJANED0E0USER0STELLAR0PUBLIC0KEY00000000000000000000000',
    },
  });

  const keeper = await prisma.user.create({
    data: {
      email: 'bob@example.com',
      password: '$2b$10$placeholder_hash_keeper',
      firstName: 'Bob',
      lastName: 'Smith',
      role: 'USER',
    },
  });

  console.log(`  ✓ Created ${4} users`);

  // ─── Pets ────────────────────────────────────────────────

  const buddy = await prisma.pet.create({
    data: {
      name: 'Buddy',
      species: 'DOG',
      breed: 'Golden Retriever',
      age: 3,
      description:
        'Friendly and energetic golden retriever who loves playing fetch.',
      status: 'AVAILABLE',
      ownerId: shelter.id,
    },
  });

  const whiskers = await prisma.pet.create({
    data: {
      name: 'Whiskers',
      species: 'CAT',
      breed: 'Siamese',
      age: 2,
      description: 'Calm and affectionate indoor cat. Great with children.',
      status: 'AVAILABLE',
      ownerId: shelter.id,
    },
  });

  const tweety = await prisma.pet.create({
    data: {
      name: 'Tweety',
      species: 'BIRD',
      breed: 'Canary',
      age: 1,
      description: 'Beautiful singing canary with bright yellow feathers.',
      status: 'AVAILABLE',
      ownerId: shelter.id,
    },
  });

  const max = await prisma.pet.create({
    data: {
      name: 'Max',
      species: 'DOG',
      breed: 'German Shepherd',
      age: 4,
      description: 'Well-trained and loyal. Needs a home with a yard.',
      status: 'PENDING',
      ownerId: shelter.id,
    },
  });

  console.log(`  ✓ Created ${4} pets`);

  // ─── Adoption Requests ───────────────────────────────────

  const adoptionRequest = await prisma.adoptionRequest.create({
    data: {
      status: 'PENDING',
      notes: 'I have a large backyard and experience with shepherds.',
      petId: max.id,
      adopterId: adopter.id,
      ownerId: shelter.id,
    },
  });

  console.log(`  ✓ Created 1 adoption request`);

  // ─── Custody Agreements ──────────────────────────────────

  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  await prisma.custodyAgreement.create({
    data: {
      status: 'ACTIVE',
      depositAmount: 150.0,
      startDate: now,
      endDate: twoWeeksLater,
      terms: 'Daily walks, regular feeding schedule, no off-leash in public.',
      petId: buddy.id,
      ownerId: shelter.id,
      keeperId: keeper.id,
    },
  });

  console.log(`  ✓ Created 1 custody agreement`);

  // ─── Event Logs ──────────────────────────────────────────

  await prisma.eventLog.createMany({
    data: [
      {
        type: 'USER_REGISTERED',
        aggregateId: adopter.id,
        payload: { email: adopter.email },
      },
      {
        type: 'PET_LISTED',
        aggregateId: buddy.id,
        payload: { name: buddy.name, species: buddy.species },
      },
      {
        type: 'PET_LISTED',
        aggregateId: whiskers.id,
        payload: { name: whiskers.name, species: whiskers.species },
      },
      {
        type: 'ADOPTION_REQUESTED',
        aggregateId: adoptionRequest.id,
        payload: { petId: max.id, adopterId: adopter.id },
      },
    ],
  });

  console.log(`  ✓ Created 4 event logs`);

  console.log('✅ Seeding complete!');
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
