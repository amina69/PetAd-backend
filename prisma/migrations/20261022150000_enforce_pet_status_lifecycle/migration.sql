ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADOPTION_REJECTED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADOPTION_CANCELLED';

CREATE TYPE "PetStatus" AS ENUM ('AVAILABLE', 'PENDING', 'IN_CUSTODY', 'ADOPTED');

ALTER TABLE "pets"
ADD COLUMN "status" "PetStatus" NOT NULL DEFAULT 'AVAILABLE';

UPDATE "pets" AS pet
SET "status" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "adoptions" AS adoption
    WHERE adoption."pet_id" = pet."id"
      AND adoption."status" = 'COMPLETED'
  ) THEN 'ADOPTED'::"PetStatus"
  WHEN EXISTS (
    SELECT 1 FROM "custodies" AS custody
    WHERE custody."pet_id" = pet."id"
      AND custody."status" = 'ACTIVE'
  ) THEN 'IN_CUSTODY'::"PetStatus"
  WHEN EXISTS (
    SELECT 1 FROM "adoptions" AS adoption
    WHERE adoption."pet_id" = pet."id"
      AND adoption."status" IN ('REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED')
  ) THEN 'PENDING'::"PetStatus"
  ELSE 'AVAILABLE'::"PetStatus"
END;

CREATE INDEX "pets_status_idx" ON "pets"("status");