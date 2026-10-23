-- Location fields and geo search (Issue #232 / BE-035)
--
-- Adds listing location columns to pets. Coordinates are stored as DOUBLE
-- PRECISION but written by the application rounded to 3 decimal places
-- (~100 m), so an owner's exact address is never persisted or returned.
--
-- NOTE: this migration was trimmed from the `prisma migrate dev` output.
-- The raw output also dropped "EventLedger" and added EventType enum values
-- because schema.prisma has drifted from the migration history (EventLedger
-- is created by 20260728120000 via raw SQL, and CUSTODY_VIOLATION /
-- CUSTODY_CANCELLED / ESCROW_REFUNDED have no ADD VALUE migration yet).
-- Those unrelated drift fixes are intentionally left out here so this
-- migration only delivers the location columns for this issue.

-- AlterTable
ALTER TABLE "pets" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "state" TEXT;

-- CreateIndex
CREATE INDEX "pets_latitude_longitude_idx" ON "pets"("latitude", "longitude");
