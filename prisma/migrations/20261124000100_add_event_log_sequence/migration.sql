-- EventLedgerService allocates a per-aggregate sequence number inside the
-- append transaction, but the mapped event_logs table never had the column.
-- Without it every real ledger append (and therefore anchoring) failed.

ALTER TABLE "event_logs"
  ADD COLUMN IF NOT EXISTS "sequence_number" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_idx"
  ON "event_logs"("entity_id", "sequence_number");
