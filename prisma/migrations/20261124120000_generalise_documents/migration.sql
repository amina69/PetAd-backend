-- Generalise documents: a document no longer has to belong to an adoption.
-- The polymorphic (entityType, entityId) pair becomes the canonical owner,
-- adoptionId is kept (now nullable) for legacy rows and adoption lookups.
--
-- The Prisma client maps this model onto the "documents" table (camelCase
-- columns); the legacy "Document" table is left untouched.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentKind') THEN
    CREATE TYPE "DocumentKind" AS ENUM ('ID', 'PROOF_OF_ADDRESS', 'VACCINATION', 'EVIDENCE', 'MESSAGE_ATTACHMENT', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus') THEN
    CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentEntityType') THEN
    CREATE TYPE "DocumentEntityType" AS ENUM ('ADOPTION', 'CUSTODY', 'DISPUTE', 'MESSAGE', 'HEALTH_RECORD', 'PROFILE', 'OTHER');
  END IF;
END $$;

-- AlterTable: adoptionId becomes optional so non-adoption documents can exist
ALTER TABLE "documents" ALTER COLUMN "adoptionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sha256" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "entityType" "DocumentEntityType";
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "entityId" TEXT;

-- Backfill: every existing document keeps its adoption as its owner and is
-- treated as a verified historical upload (it predates the review workflow).
UPDATE "documents"
SET
  "entityType" = CASE
    WHEN "adoptionId" IS NULL THEN 'OTHER'::"DocumentEntityType"
    ELSE 'ADOPTION'::"DocumentEntityType"
  END,
  "entityId" = COALESCE("adoptionId", "id"),
  "status" = 'VERIFIED'::"DocumentStatus"
WHERE "entityType" IS NULL OR "entityId" IS NULL;

ALTER TABLE "documents" ALTER COLUMN "entityType" SET NOT NULL;
ALTER TABLE "documents" ALTER COLUMN "entityId" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_entityType_entityId_idx" ON "documents"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "documents_uploadedById_idx" ON "documents"("uploadedById");
CREATE INDEX IF NOT EXISTS "documents_adoptionId_idx" ON "documents"("adoptionId");
