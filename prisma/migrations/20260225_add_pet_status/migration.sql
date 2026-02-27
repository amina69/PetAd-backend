-- AddColumn to Pet model for status
-- This migration adds the status column to the pets table with AVAILABLE as the default

ALTER TABLE "pets" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'AVAILABLE';

-- Create index on status for efficient filtering
CREATE INDEX "pets_status_idx" ON "pets"("status");

-- Add constraint to ensure valid status values (PostgreSQL check constraint)
ALTER TABLE "pets" ADD CONSTRAINT "pets_status_check"
  CHECK ("status" IN ('AVAILABLE', 'PENDING', 'IN_CUSTODY', 'ADOPTED'));

