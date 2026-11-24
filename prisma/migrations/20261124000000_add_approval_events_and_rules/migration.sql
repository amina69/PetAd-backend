-- AddValue
ALTER TYPE "EventEntityType" ADD VALUE IF NOT EXISTS 'APPROVAL';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ApprovalEvaluationMode" AS ENUM ('SEQUENTIAL', 'PARALLEL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddValues to EventType
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'APPROVAL_GRANTED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'APPROVAL_REJECTED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'APPROVAL_EXPIRED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'APPROVAL_REASSIGNED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_rules" (
    "id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "required_groups" TEXT[],
    "quorum" INTEGER NOT NULL DEFAULT 1,
    "mode" "ApprovalEvaluationMode" NOT NULL DEFAULT 'PARALLEL',
    "veto_on_reject" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_rules_request_type_key" ON "approval_rules"("request_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_rules_request_type_idx" ON "approval_rules"("request_type");
