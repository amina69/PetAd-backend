-- Anchoring: batches of ledger events committed to Stellar.
-- The Merkle root of a batch is stored in the transaction memo hash.

ALTER TYPE "EventEntityType" ADD VALUE IF NOT EXISTS 'ANCHOR';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'EVENTS_ANCHORED';

DO $$
BEGIN
  CREATE TYPE "AnchorBatchStatus" AS ENUM (
    'OPEN',
    'SUBMITTED',
    'CONFIRMED',
    'DISPUTED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "anchor_batches" (
  "id" TEXT NOT NULL,
  "merkle_root" TEXT,
  "status" "AnchorBatchStatus" NOT NULL DEFAULT 'OPEN',
  "tx_hash" TEXT,
  "block_height" INTEGER,
  "leaf_count" INTEGER NOT NULL DEFAULT 0,
  "submitted_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "dispute_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "anchor_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "anchor_batches_tx_hash_key"
  ON "anchor_batches"("tx_hash");
CREATE INDEX IF NOT EXISTS "anchor_batches_status_idx"
  ON "anchor_batches"("status");

CREATE TABLE IF NOT EXISTS "anchor_batch_leaves" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "event_log_id" TEXT NOT NULL,
  "event_hash" TEXT NOT NULL,
  "leaf_index" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "anchor_batch_leaves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "anchor_batch_leaves_event_log_id_key"
  ON "anchor_batch_leaves"("event_log_id");
CREATE INDEX IF NOT EXISTS "anchor_batch_leaves_batch_id_idx"
  ON "anchor_batch_leaves"("batch_id");
CREATE INDEX IF NOT EXISTS "anchor_batch_leaves_event_hash_idx"
  ON "anchor_batch_leaves"("event_hash");

DO $$
BEGIN
  ALTER TABLE "anchor_batch_leaves"
    ADD CONSTRAINT "anchor_batch_leaves_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "anchor_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "event_logs"
  ADD COLUMN IF NOT EXISTS "anchor_batch_id" TEXT;
