-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'ANCHORED', 'FAILED');

-- CreateTable
CREATE TABLE "EventLedger" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid()::text),
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT,
    "stellarTxHash" TEXT,
    "anchorStatus" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,

    CONSTRAINT "EventLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventLedger_aggregateId_sequenceNumber_key" ON "EventLedger"("aggregateId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "EventLedger_aggregateId_idx" ON "EventLedger"("aggregateId");

-- CreateIndex
CREATE INDEX "EventLedger_aggregateType_idx" ON "EventLedger"("aggregateType");

-- CreateIndex
CREATE INDEX "EventLedger_eventType_idx" ON "EventLedger"("eventType");

-- CreateIndex
CREATE INDEX "EventLedger_occurredAt_idx" ON "EventLedger"("occurredAt");