-- Email verification for messaging eligibility.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_expires_at" TIMESTAMP(3);

-- Accounts created before email verification existed are grandfathered in;
-- new registrations start unverified.
UPDATE "users"
SET "email_verified" = true,
    "email_verified_at" = COALESCE("email_verified_at", "created_at", CURRENT_TIMESTAMP)
WHERE "email_verified" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_verification_token_hash_key"
  ON "users"("email_verification_token_hash");

-- Conversations: one per (pet, participant pair). Participant ids are stored
-- in ascending order by the service so this unique key enforces idempotency.
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" TEXT NOT NULL,
  "pet_id" TEXT NOT NULL,
  "participant_one_id" TEXT NOT NULL,
  "participant_two_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_pet_id_participant_one_id_participant_two_id_key"
  ON "conversations"("pet_id", "participant_one_id", "participant_two_id");
CREATE INDEX IF NOT EXISTS "conversations_participant_one_id_idx" ON "conversations"("participant_one_id");
CREATE INDEX IF NOT EXISTS "conversations_participant_two_id_idx" ON "conversations"("participant_two_id");

ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_pet_id_fkey";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pet_id_fkey"
  FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_participant_one_id_fkey";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_one_id_fkey"
  FOREIGN KEY ("participant_one_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_participant_two_id_fkey";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_two_id_fkey"
  FOREIGN KEY ("participant_two_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "conversation_participants" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "last_read_message_id" TEXT,
  "last_read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversation_id_user_id_key"
  ON "conversation_participants"("conversation_id", "user_id");
CREATE INDEX IF NOT EXISTS "conversation_participants_user_id_idx"
  ON "conversation_participants"("user_id");

ALTER TABLE "conversation_participants" DROP CONSTRAINT IF EXISTS "conversation_participants_conversation_id_fkey";
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_participants" DROP CONSTRAINT IF EXISTS "conversation_participants_user_id_fkey";
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "messages_conversation_id_created_at_idx"
  ON "messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "messages_sender_id_idx" ON "messages"("sender_id");

ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_conversation_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "message_attachments" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_attachments_document_id_key"
  ON "message_attachments"("document_id");
CREATE INDEX IF NOT EXISTS "message_attachments_message_id_idx"
  ON "message_attachments"("message_id");

ALTER TABLE "message_attachments" DROP CONSTRAINT IF EXISTS "message_attachments_message_id_fkey";
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_attachments" DROP CONSTRAINT IF EXISTS "message_attachments_document_id_fkey";
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "blocks" (
  "id" TEXT NOT NULL,
  "blocker_id" TEXT NOT NULL,
  "blocked_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "blocks_blocker_id_blocked_id_key"
  ON "blocks"("blocker_id", "blocked_id");
CREATE INDEX IF NOT EXISTS "blocks_blocked_id_idx" ON "blocks"("blocked_id");

ALTER TABLE "blocks" DROP CONSTRAINT IF EXISTS "blocks_blocker_id_fkey";
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey"
  FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" DROP CONSTRAINT IF EXISTS "blocks_blocked_id_fkey";
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey"
  FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "reports" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "reporter_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reports_conversation_id_idx" ON "reports"("conversation_id");
CREATE INDEX IF NOT EXISTS "reports_created_at_idx" ON "reports"("created_at");

ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_conversation_id_fkey";
ALTER TABLE "reports" ADD CONSTRAINT "reports_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_reporter_id_fkey";
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey"
  FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The evidence snapshot is write-once: moderation may add notes elsewhere,
-- but the captured messages must never be edited or backfilled afterwards.
CREATE OR REPLACE FUNCTION "Report_snapshot_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."snapshot" IS DISTINCT FROM OLD."snapshot" THEN
    RAISE EXCEPTION 'Report snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Report_snapshot_immutable_update" ON "reports";

CREATE TRIGGER "Report_snapshot_immutable_update"
BEFORE UPDATE ON "reports"
FOR EACH ROW
EXECUTE FUNCTION "Report_snapshot_immutable"();
