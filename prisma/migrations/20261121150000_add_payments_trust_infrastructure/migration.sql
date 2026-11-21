-- Versioned fee schedules, payments ledger, webhook idempotency and trust anti-abuse.

CREATE TYPE "PaymentLedgerEntryType" AS ENUM ('FEE_COLLECTED', 'FEE_REFUNDED');
CREATE TYPE "ReportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED');
CREATE TYPE "ReviewStatus" AS ENUM ('VISIBLE', 'FLAGGED', 'HIDDEN');
CREATE TYPE "AbuseSignalType" AS ENUM ('RECIPROCAL_REVIEW', 'REVIEW_RING', 'REPEATED_AGREEMENT', 'NEW_ACCOUNT_BURST', 'SHARED_DEVICE', 'SHARED_IP');
CREATE TYPE "AbuseFlagStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

CREATE TABLE "fee_schedules" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "platform_fee_bps" INTEGER NOT NULL,
    "minimum_fee" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "late_penalty_bps" INTEGER NOT NULL,
    "deposit_rules" JSONB NOT NULL,
    "daily_custody_rates" JSONB NOT NULL,
    "cancellation_lead_times" JSONB NOT NULL,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_ledger_entries" (
    "id" TEXT NOT NULL,
    "type" "PaymentLedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "escrow_id" TEXT,
    "fee_schedule_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revenue_report_jobs" (
    "id" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "from_date" TIMESTAMP(3) NOT NULL,
    "to_date" TIMESTAMP(3) NOT NULL,
    "group_by" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "csv_content" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_report_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "reviewee_id" TEXT NOT NULL,
    "agreement_id" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "device_hash" TEXT,
    "ip_hash" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'VISIBLE',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abuse_signals" (
    "id" TEXT NOT NULL,
    "type" "AbuseSignalType" NOT NULL,
    "review_id" TEXT,
    "subject_user_id" TEXT,
    "actor_user_id" TEXT,
    "counterparty_user_id" TEXT,
    "hashed_value" TEXT,
    "reason" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "status" "AbuseFlagStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_signals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "escrows" ADD COLUMN "fee_schedule_id" TEXT;

CREATE UNIQUE INDEX "fee_schedules_version_key" ON "fee_schedules"("version");
CREATE INDEX "fee_schedules_effective_from_effective_to_idx" ON "fee_schedules"("effective_from", "effective_to");
CREATE UNIQUE INDEX "payment_ledger_entries_type_escrow_id_key" ON "payment_ledger_entries"("type", "escrow_id");
CREATE INDEX "payment_ledger_entries_type_occurred_at_idx" ON "payment_ledger_entries"("type", "occurred_at");
CREATE INDEX "payment_ledger_entries_currency_occurred_at_idx" ON "payment_ledger_entries"("currency", "occurred_at");
CREATE INDEX "revenue_report_jobs_status_created_at_idx" ON "revenue_report_jobs"("status", "created_at");
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");
CREATE INDEX "reviews_reviewee_id_status_idx" ON "reviews"("reviewee_id", "status");
CREATE INDEX "reviews_reviewer_id_idx" ON "reviews"("reviewer_id");
CREATE INDEX "reviews_created_at_idx" ON "reviews"("created_at");
CREATE INDEX "abuse_signals_status_created_at_idx" ON "abuse_signals"("status", "created_at");
CREATE INDEX "abuse_signals_review_id_idx" ON "abuse_signals"("review_id");
CREATE INDEX "abuse_signals_type_idx" ON "abuse_signals"("type");
CREATE INDEX "escrows_fee_schedule_id_idx" ON "escrows"("fee_schedule_id");

ALTER TABLE "escrows" ADD CONSTRAINT "escrows_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
