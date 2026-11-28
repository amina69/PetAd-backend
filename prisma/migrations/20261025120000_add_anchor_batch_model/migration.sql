-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchor_batches" (
    "id" TEXT NOT NULL,
    "from_position" INTEGER NOT NULL,
    "to_position" INTEGER NOT NULL,
    "leaf_count" INTEGER NOT NULL,
    "merkle_root" TEXT NOT NULL,
    "tx_hash" TEXT,
    "ledger" BIGINT,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "network" TEXT NOT NULL DEFAULT 'STELLAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchor_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anchor_leaves" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "event_log_id" TEXT NOT NULL,
    "leaf_hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anchor_leaves_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "event_logs" ADD COLUMN "anchor_batch_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "anchor_batches_from_position_to_position_network_key" ON "anchor_batches"("from_position", "to_position", "network");

-- CreateIndex
CREATE INDEX "anchor_leaves_batch_id_idx" ON "anchor_leaves"("batch_id");

-- CreateIndex
CREATE INDEX "event_logs_anchor_batch_id_idx" ON "event_logs"("anchor_batch_id");

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_anchor_batch_id_fkey" FOREIGN KEY ("anchor_batch_id") REFERENCES "anchor_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anchor_leaves" ADD CONSTRAINT "anchor_leaves_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "anchor_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anchor_leaves" ADD CONSTRAINT "anchor_leaves_event_log_id_fkey" FOREIGN KEY ("event_log_id") REFERENCES "event_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability trigger for confirmed AnchorBatches
CREATE OR REPLACE FUNCTION check_anchor_batch_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Cannot update or delete a confirmed AnchorBatch' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_anchor_batch_immutability
BEFORE UPDATE OR DELETE ON "anchor_batches"
FOR EACH ROW
EXECUTE FUNCTION check_anchor_batch_immutability();
