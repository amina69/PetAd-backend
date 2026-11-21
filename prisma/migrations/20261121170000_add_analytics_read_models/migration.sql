ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADOPTION_ESCROW_CREATED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADOPTION_ESCROW_FUNDED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DISPUTE_OPENED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DISPUTE_RESOLVED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PetGender') THEN
    CREATE TYPE "PetGender" AS ENUM ('MALE', 'FEMALE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PetSize') THEN
    CREATE TYPE "PetSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
  END IF;
END $$;

ALTER TABLE "pets"
  ADD COLUMN IF NOT EXISTS "gender" "PetGender",
  ADD COLUMN IF NOT EXISTS "size" "PetSize";

CREATE TABLE IF NOT EXISTS "daily_adoptions" (
  "date" DATE NOT NULL,
  "species" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "age_band" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "size" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "region" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "shelter_id" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "requested" INTEGER NOT NULL DEFAULT 0,
  "approved" INTEGER NOT NULL DEFAULT 0,
  "funded" INTEGER NOT NULL DEFAULT 0,
  "completed" INTEGER NOT NULL DEFAULT 0,
  "rejected" INTEGER NOT NULL DEFAULT 0,
  "cancelled" INTEGER NOT NULL DEFAULT 0,
  "expired" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("date", "species", "age_band", "size", "region", "shelter_id")
);

CREATE INDEX IF NOT EXISTS "daily_adoptions_date_idx" ON "daily_adoptions"("date");

CREATE TABLE IF NOT EXISTS "daily_custody" (
  "date" DATE NOT NULL,
  "species" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "region" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "shelter_id" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "created" INTEGER NOT NULL DEFAULT 0,
  "started" INTEGER NOT NULL DEFAULT 0,
  "completed" INTEGER NOT NULL DEFAULT 0,
  "returned" INTEGER NOT NULL DEFAULT 0,
  "cancelled" INTEGER NOT NULL DEFAULT 0,
  "violation" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("date", "species", "region", "shelter_id")
);

CREATE INDEX IF NOT EXISTS "daily_custody_date_idx" ON "daily_custody"("date");

CREATE TABLE IF NOT EXISTS "daily_disputes" (
  "date" DATE NOT NULL,
  "species" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "region" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "shelter_id" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "opened" INTEGER NOT NULL DEFAULT 0,
  "resolved" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("date", "species", "region", "shelter_id")
);

CREATE INDEX IF NOT EXISTS "daily_disputes_date_idx" ON "daily_disputes"("date");

CREATE TABLE IF NOT EXISTS "daily_users" (
  "date" DATE NOT NULL,
  "region" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "shelter_id" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "registered" INTEGER NOT NULL DEFAULT 0,
  "suspended" INTEGER NOT NULL DEFAULT 0,
  "reinstated" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("date", "region", "shelter_id")
);

CREATE INDEX IF NOT EXISTS "daily_users_date_idx" ON "daily_users"("date");

CREATE TABLE IF NOT EXISTS "analytics_projection_state" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "last_processed_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_count" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "analytics_projection_state" ("key", "row_count")
VALUES ('daily_aggregates', 0)
ON CONFLICT ("key") DO NOTHING;
