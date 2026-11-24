-- Extend DisputeStatus with new states required for state machine (#292)
ALTER TYPE "DisputeStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
ALTER TYPE "DisputeStatus" ADD VALUE IF NOT EXISTS 'RESOLUTION_PENDING';

-- DisputeOutcome enum for admin resolution (#293)
DO $$ BEGIN
  CREATE TYPE "DisputeOutcome" AS ENUM ('RELEASE_TO_OWNER', 'REFUND_TO_HOLDER', 'SPLIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- NotificationType enum for in-app notifications (#298)
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'APPROVAL_STATUS', 'DISPUTE_UPDATE', 'CUSTODY_STATUS',
    'ADOPTION_STATUS', 'SEARCH_MATCH', 'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend disputes table: admin assignment, outcome, split_percent (#292, #293)
ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "assigned_to_id" TEXT,
  ADD COLUMN IF NOT EXISTS "outcome"         "DisputeOutcome",
  ADD COLUMN IF NOT EXISTS "split_percent"   INTEGER;

ALTER TABLE "disputes"
  ADD CONSTRAINT IF NOT EXISTS "disputes_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Notifications table (#298)
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"                   TEXT             NOT NULL,
  "user_id"              TEXT             NOT NULL,
  "type"                 "NotificationType" NOT NULL,
  "title"                TEXT             NOT NULL,
  "body"                 TEXT             NOT NULL,
  "data"                 JSONB,
  "related_entity_route" TEXT,
  "read_at"              TIMESTAMP(3),
  "retention_days"       INTEGER          NOT NULL DEFAULT 0,
  "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_created_at_idx"
  ON "notifications"("user_id", "read_at", "created_at" DESC);

ALTER TABLE "notifications"
  ADD CONSTRAINT IF NOT EXISTS "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- StatusHistory table (supports audit trail for state transitions)
CREATE TABLE IF NOT EXISTS "status_history" (
  "id"          TEXT             NOT NULL,
  "entity_type" "EventEntityType" NOT NULL,
  "entity_id"   TEXT             NOT NULL,
  "from"        TEXT             NOT NULL,
  "to"          TEXT             NOT NULL,
  "actor_id"    TEXT,
  "reason"      TEXT,
  "at"          TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "status_history_entity_type_entity_id_idx"
  ON "status_history"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "status_history_entity_id_at_idx"
  ON "status_history"("entity_id", "at");

ALTER TABLE "status_history"
  ADD CONSTRAINT IF NOT EXISTS "status_history_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
