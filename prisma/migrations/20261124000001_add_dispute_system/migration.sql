-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('PET_CONDITION', 'CUSTODY_VIOLATION', 'PAYMENT_ISSUE', 'OTHER');

-- AlterEnum: add DISPUTE to EventEntityType
ALTER TYPE "EventEntityType" ADD VALUE 'DISPUTE';

-- AlterEnum: add dispute events to EventType
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_OPENED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_RESOLVED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_COMMENT_ADDED';

-- CreateTable disputes
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "DisputeReason" NOT NULL,
    "description" TEXT NOT NULL,
    "filed_by_id" TEXT NOT NULL,
    "adoption_id" TEXT,
    "custody_id" TEXT,
    "resolution" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "disputes_entity_xor_check" CHECK (
        (adoption_id IS NOT NULL)::int + (custody_id IS NOT NULL)::int = 1
    )
);

-- CreateTable dispute_comments
CREATE TABLE "dispute_comments" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "dispute_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable dispute_evidence
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at");
CREATE INDEX "disputes_adoption_id_idx" ON "disputes"("adoption_id");
CREATE INDEX "disputes_custody_id_idx" ON "disputes"("custody_id");
CREATE INDEX "disputes_filed_by_id_idx" ON "disputes"("filed_by_id");
CREATE INDEX "dispute_comments_dispute_id_idx" ON "dispute_comments"("dispute_id");
CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_filed_by_id_fkey"
    FOREIGN KEY ("filed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_adoption_id_fkey"
    FOREIGN KEY ("adoption_id") REFERENCES "adoptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_custody_id_fkey"
    FOREIGN KEY ("custody_id") REFERENCES "custodies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dispute_comments" ADD CONSTRAINT "dispute_comments_dispute_id_fkey"
    FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_comments" ADD CONSTRAINT "dispute_comments_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey"
    FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
