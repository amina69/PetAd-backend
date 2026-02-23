-- Migration: Update pets table to match new Pet model schema
-- Created: 2026-02-22

-- Drop foreign key constraint first
ALTER TABLE "pets" DROP CONSTRAINT IF EXISTS "pets_owner_id_fkey";

-- Drop the old enum type (no longer needed since species is now String)
DROP TYPE IF EXISTS "PetSpecies";

-- Alter species column from enum to text
ALTER TABLE "pets" ALTER COLUMN "species" TYPE TEXT USING "species"::text;

-- Make age NOT NULL (set default for existing records)
ALTER TABLE "pets" ALTER COLUMN "age" SET DEFAULT 0;
UPDATE "pets" SET "age" = 0 WHERE "age" IS NULL;
ALTER TABLE "pets" ALTER COLUMN "age" SET NOT NULL;

-- Add new columns
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "size" TEXT;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "color" TEXT;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "images" TEXT[] DEFAULT '{}';

-- Rename owner_id to shelter_id
ALTER TABLE "pets" RENAME COLUMN "owner_id" TO "shelter_id";

-- Recreate foreign key with new name
ALTER TABLE "pets" ADD CONSTRAINT "pets_shelter_id_fkey" 
    FOREIGN KEY ("shelter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old index and create new one for shelter_id
DROP INDEX IF EXISTS "pets_owner_id_idx";
CREATE INDEX "pets_shelter_id_idx" ON "pets"("shelter_id");

-- Update description column to use TEXT type
ALTER TABLE "pets" ALTER COLUMN "description" TYPE TEXT USING "description"::text;
