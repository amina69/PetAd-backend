-- Shelter onboarding and verification (BE-025).
-- A SHELTER account gets at most one onboarding profile. Listing creation is
-- refused until an admin verifies it (see SheltersService.assertCanPublish).

-- CreateEnum
CREATE TYPE "ShelterVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
ALTER TYPE "EventEntityType" ADD VALUE 'SHELTER';
ALTER TYPE "EventType" ADD VALUE 'SHELTER_VERIFIED';
ALTER TYPE "EventType" ADD VALUE 'SHELTER_REJECTED';

-- CreateTable
CREATE TABLE "shelter_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_name" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "verification_status" "ShelterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shelter_profiles_user_id_key" ON "shelter_profiles"("user_id");
CREATE UNIQUE INDEX "shelter_profiles_registration_number_key" ON "shelter_profiles"("registration_number");
CREATE INDEX "shelter_profiles_verification_status_idx" ON "shelter_profiles"("verification_status");

-- AddForeignKey
ALTER TABLE "shelter_profiles" ADD CONSTRAINT "shelter_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
