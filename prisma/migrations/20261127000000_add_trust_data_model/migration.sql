-- Trust & Reputation data model (BE-141).
-- Adds append-only trust_events and trust_score_history tables plus the
-- materialized trust_summaries projection backing users."trustScore".

-- CreateEnum
CREATE TYPE "TrustEventKind" AS ENUM (
  'AGREEMENT_COMPLETED',
  'DISPUTE_LOST',
  'LATE_RETURN',
  'REVIEW_RECEIVED',
  'DOCUMENT_VERIFIED',
  'CUSTODY_RETURNED',
  'CUSTODY_VIOLATION'
);

-- CreateTable
CREATE TABLE "trust_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "TrustEventKind" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_score_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_summaries" (
    "user_id" TEXT NOT NULL,
    "current_score" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "algorithm_version" TEXT NOT NULL DEFAULT 'v1',
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "positive_events" INTEGER NOT NULL DEFAULT 0,
    "negative_events" INTEGER NOT NULL DEFAULT 0,
    "last_event_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trust_summaries_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trust_events_user_id_kind_source_event_id_key" ON "trust_events"("user_id", "kind", "source_event_id");
CREATE INDEX "trust_events_user_id_at_idx" ON "trust_events"("user_id", "at");
CREATE INDEX "trust_events_source_event_id_idx" ON "trust_events"("source_event_id");

-- CreateIndex
CREATE INDEX "trust_score_history_user_id_computed_at_idx" ON "trust_score_history"("user_id", "computed_at");

-- CreateIndex
CREATE INDEX "trust_summaries_current_score_idx" ON "trust_summaries"("current_score");

-- AddForeignKey
ALTER TABLE "trust_events" ADD CONSTRAINT "trust_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_events" ADD CONSTRAINT "trust_events_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "event_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_score_history" ADD CONSTRAINT "trust_score_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_summaries" ADD CONSTRAINT "trust_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce append-only immutability on trust_events and trust_score_history.
CREATE OR REPLACE FUNCTION "trust_events_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trust_events is append-only: % operations are not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS "trust_events_immutable_update_delete" ON "trust_events";

CREATE TRIGGER "trust_events_immutable_update_delete"
BEFORE UPDATE OR DELETE ON "trust_events"
FOR EACH ROW
EXECUTE FUNCTION "trust_events_reject_mutation"();

CREATE OR REPLACE FUNCTION "trust_score_history_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trust_score_history is append-only: % operations are not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS "trust_score_history_immutable_update_delete" ON "trust_score_history";

CREATE TRIGGER "trust_score_history_immutable_update_delete"
BEFORE UPDATE OR DELETE ON "trust_score_history"
FOR EACH ROW
EXECUTE FUNCTION "trust_score_history_reject_mutation"();
