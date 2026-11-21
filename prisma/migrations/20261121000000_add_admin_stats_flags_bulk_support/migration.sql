DO $$
BEGIN
  CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users"("created_at");

ALTER TABLE "pets"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archive_reason" TEXT;

CREATE INDEX IF NOT EXISTS "pets_archived_at_idx" ON "pets"("archived_at");

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verifiedById" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationReason" TEXT;

CREATE INDEX IF NOT EXISTS "documents_verificationStatus_idx"
  ON "documents"("verificationStatus");

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "rollout_percentage" INTEGER NOT NULL DEFAULT 0,
  "target_roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[] NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_key"
  ON "feature_flags"("key");
