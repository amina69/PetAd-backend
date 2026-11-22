-- CreateTable
CREATE TABLE IF NOT EXISTS "event_logs" (
    "id" TEXT NOT NULL,
    "entity_type" "EventEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "actor_id" TEXT,
    "sequence_number" INTEGER NOT NULL DEFAULT 1,
    "prev_hash" TEXT,
    "event_hash" TEXT,
    "tx_hash" TEXT,
    "block_height" INTEGER,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "event_logs_entity_id_sequence_number_key" ON "event_logs"("entity_id", "sequence_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "event_logs_entity_type_entity_id_idx" ON "event_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "event_logs_event_type_idx" ON "event_logs"("event_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "event_logs_created_at_idx" ON "event_logs"("created_at");
