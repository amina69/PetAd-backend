DO $$
BEGIN
  CREATE TYPE "TrustEventType" AS ENUM (
    'AGREEMENT_COMPLETED',
    'POSITIVE_REVIEW',
    'NEUTRAL_REVIEW',
    'NEGATIVE_REVIEW',
    'DISPUTE_OPENED',
    'DISPUTE_RESOLVED_IN_FAVOUR',
    'DISPUTE_RESOLVED_AGAINST',
    'VIOLATION',
    'DOCUMENT_VERIFIED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReviewAgreementType" AS ENUM ('ADOPTION', 'CUSTODY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReviewReportReason" AS ENUM (
    'SPAM',
    'ABUSE',
    'OFFENSIVE',
    'IRRELEVANT',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DISPUTE_OPENED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DISPUTE_RESOLVED_IN_FAVOUR';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DISPUTE_RESOLVED_AGAINST';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DOCUMENT_VERIFIED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'REVIEW_CREATED';
ALTER TYPE "EventEntityType" ADD VALUE IF NOT EXISTS 'REVIEW';

CREATE TABLE IF NOT EXISTS "trust_event_sources" (
  "source_event_id" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_event_sources_pkey" PRIMARY KEY ("source_event_id")
);

CREATE TABLE IF NOT EXISTS "trust_events" (
  "id" TEXT NOT NULL,
  "source_event_id" TEXT NOT NULL,
  "subject_user_id" TEXT NOT NULL,
  "type" "TrustEventType" NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trust_events_weight_positive" CHECK ("weight" > 0)
);

CREATE TABLE IF NOT EXISTS "trust_scores" (
  "user_id" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "band" TEXT NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "factors" JSONB NOT NULL,
  "event_count" INTEGER NOT NULL DEFAULT 0,
  "completed_agreements" INTEGER NOT NULL DEFAULT 0,
  "disputes_total" INTEGER NOT NULL DEFAULT 0,
  "disputes_resolved_in_favour" INTEGER NOT NULL DEFAULT 0,
  "anchored_through" TEXT,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trust_scores_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "trust_scores_score_range" CHECK ("score" >= 0 AND "score" <= 100)
);

CREATE TABLE IF NOT EXISTS "reviews" (
  "id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "agreement_type" "ReviewAgreementType" NOT NULL,
  "adoption_id" TEXT,
  "custody_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5),
  CONSTRAINT "reviews_title_length" CHECK (char_length("title") BETWEEN 1 AND 80),
  CONSTRAINT "reviews_body_length" CHECK (char_length("body") BETWEEN 20 AND 1000),
  CONSTRAINT "reviews_one_agreement" CHECK (
    (CASE WHEN "adoption_id" IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN "custody_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
  ),
  CONSTRAINT "reviews_no_self_review" CHECK ("reviewer_id" <> "subject_id")
);

CREATE TABLE IF NOT EXISTS "review_responses" (
  "id" TEXT NOT NULL,
  "review_id" TEXT NOT NULL,
  "responder_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_responses_body_length" CHECK (char_length("body") BETWEEN 1 AND 1000)
);

CREATE TABLE IF NOT EXISTS "review_reports" (
  "id" TEXT NOT NULL,
  "review_id" TEXT NOT NULL,
  "reporter_id" TEXT NOT NULL,
  "reason" "ReviewReportReason" NOT NULL,
  "details" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trust_event_sources_processed_at_idx"
  ON "trust_event_sources" ("processed_at");

CREATE UNIQUE INDEX IF NOT EXISTS "trust_events_source_subject_type_key"
  ON "trust_events" ("source_event_id", "subject_user_id", "type");

CREATE INDEX IF NOT EXISTS "trust_events_subject_occurred_at_idx"
  ON "trust_events" ("subject_user_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "trust_events_type_idx"
  ON "trust_events" ("type");

CREATE INDEX IF NOT EXISTS "trust_scores_score_idx"
  ON "trust_scores" ("score");

CREATE INDEX IF NOT EXISTS "trust_scores_algorithm_version_idx"
  ON "trust_scores" ("algorithm_version");

CREATE INDEX IF NOT EXISTS "reviews_subject_created_at_idx"
  ON "reviews" ("subject_id", "created_at");

CREATE INDEX IF NOT EXISTS "reviews_reviewer_id_idx"
  ON "reviews" ("reviewer_id");

CREATE INDEX IF NOT EXISTS "reviews_adoption_id_idx"
  ON "reviews" ("adoption_id");

CREATE INDEX IF NOT EXISTS "reviews_custody_id_idx"
  ON "reviews" ("custody_id");

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_adoption_reviewer_unique"
  ON "reviews" ("adoption_id", "reviewer_id")
  WHERE "adoption_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_custody_reviewer_unique"
  ON "reviews" ("custody_id", "reviewer_id")
  WHERE "custody_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "review_responses_review_id_key"
  ON "review_responses" ("review_id");

CREATE INDEX IF NOT EXISTS "review_responses_responder_id_idx"
  ON "review_responses" ("responder_id");

CREATE UNIQUE INDEX IF NOT EXISTS "review_reports_review_reporter_key"
  ON "review_reports" ("review_id", "reporter_id");

CREATE INDEX IF NOT EXISTS "review_reports_reason_idx"
  ON "review_reports" ("reason");

ALTER TABLE "trust_event_sources"
  ADD CONSTRAINT "trust_event_sources_source_event_id_fkey"
  FOREIGN KEY ("source_event_id") REFERENCES "event_logs" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trust_events"
  ADD CONSTRAINT "trust_events_source_event_id_fkey"
  FOREIGN KEY ("source_event_id") REFERENCES "trust_event_sources" ("source_event_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trust_events"
  ADD CONSTRAINT "trust_events_subject_user_id_fkey"
  FOREIGN KEY ("subject_user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trust_scores"
  ADD CONSTRAINT "trust_scores_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_adoption_id_fkey"
  FOREIGN KEY ("adoption_id") REFERENCES "adoptions" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_custody_id_fkey"
  FOREIGN KEY ("custody_id") REFERENCES "custodies" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_responses"
  ADD CONSTRAINT "review_responses_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "reviews" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_responses"
  ADD CONSTRAINT "review_responses_responder_id_fkey"
  FOREIGN KEY ("responder_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_reports"
  ADD CONSTRAINT "review_reports_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "reviews" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_reports"
  ADD CONSTRAINT "review_reports_reporter_id_fkey"
  FOREIGN KEY ("reporter_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
