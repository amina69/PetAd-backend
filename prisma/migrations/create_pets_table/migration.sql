-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SHELTER');

-- CreateEnum
CREATE TYPE "PetSpecies" AS ENUM ('DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER');

-- CreateEnum
CREATE TYPE "AdoptionStatus" AS ENUM ('REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('ACTIVE', 'RETURNED', 'CANCELLED', 'VIOLATION');

-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('OWNER', 'TEMPORARY', 'SHELTER');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('CREATED', 'FUNDED', 'RELEASED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "EventEntityType" AS ENUM ('USER', 'PET', 'ADOPTION', 'CUSTODY', 'ESCROW');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('USER_REGISTERED', 'PET_REGISTERED', 'ADOPTION_REQUESTED', 'ADOPTION_APPROVED', 'ADOPTION_COMPLETED', 'CUSTODY_STARTED', 'CUSTODY_RETURNED', 'ESCROW_CREATED', 'ESCROW_FUNDED', 'ESCROW_RELEASED', 'TRUST_SCORE_UPDATED');

-- CreateEnum
CREATE TYPE "PetStatus" AS ENUM ('AVAILABLE', 'PENDING', 'ADOPTED', 'IN_CUSTODY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "stellar_public_key" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "breed" TEXT,
    "age" INTEGER NOT NULL,
    "gender" TEXT,
    "size" TEXT,
    "color" TEXT,
    "description" TEXT,
    "images" TEXT[],
    "status" "PetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "shelterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adoptions" (
    "id" TEXT NOT NULL,
    "status" "AdoptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "pet_id" TEXT NOT NULL,
    "adopter_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "escrow_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adoptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custodies" (
    "id" TEXT NOT NULL,
    "status" "CustodyStatus" NOT NULL DEFAULT 'ACTIVE',
    "type" "CustodyType" NOT NULL,
    "depositAmount" DECIMAL(12,2),
    "start_date" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "pet_id" TEXT NOT NULL,
    "holder_id" TEXT NOT NULL,
    "escrow_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrows" (
    "id" TEXT NOT NULL,
    "stellar_public_key" TEXT NOT NULL,
    "stellar_secret_encrypted" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL DEFAULT 'XLM',
    "asset_issuer" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "funding_tx_hash" TEXT,
    "release_tx_hash" TEXT,
    "refund_tx_hash" TEXT,
    "requiredSignatures" INTEGER NOT NULL DEFAULT 2,
    "status" "EscrowStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "entity_type" "EventEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "actor_id" TEXT,
    "tx_hash" TEXT,
    "block_height" INTEGER,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stellar_public_key_key" ON "users"("stellar_public_key");

-- CreateIndex
CREATE INDEX "Pet_status_idx" ON "Pet"("status");

-- CreateIndex
CREATE INDEX "Pet_species_idx" ON "Pet"("species");

-- CreateIndex
CREATE INDEX "Pet_shelterId_idx" ON "Pet"("shelterId");

-- CreateIndex
CREATE UNIQUE INDEX "adoptions_escrow_id_key" ON "adoptions"("escrow_id");

-- CreateIndex
CREATE INDEX "adoptions_status_idx" ON "adoptions"("status");

-- CreateIndex
CREATE INDEX "adoptions_adopter_id_idx" ON "adoptions"("adopter_id");

-- CreateIndex
CREATE INDEX "adoptions_owner_id_idx" ON "adoptions"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "custodies_escrow_id_key" ON "custodies"("escrow_id");

-- CreateIndex
CREATE INDEX "custodies_status_idx" ON "custodies"("status");

-- CreateIndex
CREATE INDEX "custodies_holder_id_idx" ON "custodies"("holder_id");

-- CreateIndex
CREATE UNIQUE INDEX "escrows_stellar_public_key_key" ON "escrows"("stellar_public_key");

-- CreateIndex
CREATE INDEX "escrows_status_idx" ON "escrows"("status");

-- CreateIndex
CREATE INDEX "event_logs_entity_type_entity_id_idx" ON "event_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "event_logs_event_type_idx" ON "event_logs"("event_type");

-- CreateIndex
CREATE INDEX "event_logs_created_at_idx" ON "event_logs"("created_at");

-- AddForeignKey
ALTER TABLE "Pet" ADD CONSTRAINT "Pet_shelterId_fkey" FOREIGN KEY ("shelterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_adopter_id_fkey" FOREIGN KEY ("adopter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custodies" ADD CONSTRAINT "custodies_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custodies" ADD CONSTRAINT "custodies_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custodies" ADD CONSTRAINT "custodies_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

