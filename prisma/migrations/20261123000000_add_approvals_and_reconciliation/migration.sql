-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('ADOPTION', 'CUSTODY', 'ESCROW_RELEASE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'REJECT');

-- AlterEnum: add APPROVAL to EventEntityType
ALTER TYPE "EventEntityType" ADD VALUE 'APPROVAL';

-- AlterEnum: add approval-related event types
ALTER TYPE "EventType" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "EventType" ADD VALUE 'APPROVAL_APPROVED';
ALTER TYPE "EventType" ADD VALUE 'APPROVAL_REJECTED';
ALTER TYPE "EventType" ADD VALUE 'APPROVAL_EXPIRED';

-- CreateTable: approval_requests
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reference_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_decisions
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "decider_id" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: reconciliation_runs
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "escrows_checked" INTEGER NOT NULL DEFAULT 0,
    "discrepancies" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_requests_requester_id_idx" ON "approval_requests"("requester_id");

-- CreateIndex
CREATE INDEX "approval_requests_reference_id_idx" ON "approval_requests"("reference_id");

-- CreateIndex
CREATE INDEX "approval_requests_expires_at_idx" ON "approval_requests"("expires_at");

-- CreateIndex
CREATE INDEX "approval_decisions_approval_request_id_idx" ON "approval_decisions"("approval_request_id");

-- CreateIndex
CREATE INDEX "approval_decisions_decider_id_idx" ON "approval_decisions"("decider_id");

-- CreateIndex
CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs"("started_at");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decider_id_fkey" FOREIGN KEY ("decider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
