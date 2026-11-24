-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN', 'RESOLUTION_PENDING');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('RELEASE_TO_OWNER', 'REFUND_TO_HOLDER', 'SPLIT');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('PET_CONDITION', 'CUSTODY_VIOLATION', 'PAYMENT_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_STATUS', 'DISPUTE_UPDATE', 'CUSTODY_STATUS', 'ADOPTION_STATUS', 'SEARCH_MATCH', 'SYSTEM');

-- AlterEnum: add DISPUTE to EventEntityType
ALTER TYPE "EventEntityType" ADD VALUE 'DISPUTE';

-- AlterEnum: add dispute events to EventType
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_OPENED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_RESOLVED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_COMMENT_ADDED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_EVIDENCE_ADDED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_ASSIGNED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTE_WITHDRAWN';

-- CreateTable disputes
CREATE TABLE "disputes" (
  "id"             TEXT         NOT NULL,
  "status"         "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "reason"         "DisputeReason" NOT NULL,
  "description"    TEXT         NOT NULL,
  "filed_by_id"    TEXT         NOT NULL,
  "adoption_id"    TEXT,
  "custody_id"     TEXT,
  "assigned_to_id" TEXT,
  "outcome"        "DisputeOutcome",
  "split_percent"  INTEGER,
  "resolution"     TEXT,
  "resolved_by_id" TEXT,
  "resolved_at"    TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
  -- Exactly one of adoption_id or custody_id must be non-null
  CONSTRAINT "disputes_entity_xor_check" CHECK (
    ("adoption_id" IS NOT NULL AND "custody_id" IS NULL) OR
    ("adoption_id" IS NULL AND "custody_id" IS NOT NULL)
  )
);

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at");
CREATE INDEX "disputes_adoption_id_idx" ON "disputes"("adoption_id");
CREATE INDEX "disputes_custody_id_idx" ON "disputes"("custody_id");
CREATE INDEX "disputes_filed_by_id_idx" ON "disputes"("filed_by_id");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_filed_by_id_fkey"
  FOREIGN KEY ("filed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_adoption_id_fkey"
  FOREIGN KEY ("adoption_id") REFERENCES "adoptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_custody_id_fkey"
  FOREIGN KEY ("custody_id") REFERENCES "custodies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable dispute_comments
CREATE TABLE "dispute_comments" (
  "id"         TEXT         NOT NULL,
  "body"       TEXT         NOT NULL,
  "internal"   BOOLEAN      NOT NULL DEFAULT false,
  "dispute_id" TEXT         NOT NULL,
  "author_id"  TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispute_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dispute_comments_dispute_id_idx" ON "dispute_comments"("dispute_id");

ALTER TABLE "dispute_comments" ADD CONSTRAINT "dispute_comments_dispute_id_fkey"
  FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispute_comments" ADD CONSTRAINT "dispute_comments_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable dispute_evidence
CREATE TABLE "dispute_evidence" (
  "id"         TEXT         NOT NULL,
  "file_url"   TEXT         NOT NULL,
  "file_name"  TEXT         NOT NULL,
  "dispute_id" TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey"
  FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable notifications
CREATE TABLE "notifications" (
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

CREATE INDEX "notifications_user_id_read_at_created_at_idx"
  ON "notifications"("user_id", "read_at", "created_at" DESC);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable status_history
CREATE TABLE "status_history" (
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

CREATE INDEX "status_history_entity_type_entity_id_idx" ON "status_history"("entity_type", "entity_id");
CREATE INDEX "status_history_entity_id_at_idx" ON "status_history"("entity_id", "at");

ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
