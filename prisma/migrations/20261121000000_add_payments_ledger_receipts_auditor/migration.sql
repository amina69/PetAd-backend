-- Epic P (BE-152 / BE-154) and Epic Q (BE-162).
--
-- Adds the payments ledger (payments, double-entry payment lines, quotes and
-- refunds), private receipts with gap-free sequential numbers, and the
-- AUDITOR role used by the admin audit log API.
--
-- Money is stored as integer minor units (BIGINT). Floating point is never
-- used for monetary amounts.

-- ─── Enums ───────────────────────────────────────────────

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AUDITOR';

CREATE TYPE "PaymentPurpose" AS ENUM ('DEPOSIT', 'FEE', 'TOPUP', 'REFUND');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "PaymentLineDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "PaymentLineType" AS ENUM ('PRINCIPAL', 'FEE', 'TAX', 'PENALTY', 'REFUND');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- ─── Tables ──────────────────────────────────────────────

CREATE TABLE "payment_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "amount_minor" BIGINT NOT NULL,
    "fee_rate_bps" INTEGER NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "escrow_id" TEXT,
    "custody_id" TEXT,
    "adoption_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_quotes_amount_minor_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "payment_quotes_fee_rate_bps_range" CHECK ("fee_rate_bps" >= 0 AND "fee_rate_bps" <= 10000)
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fee_rate_bps" INTEGER NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "settlement_refund_minor" BIGINT,
    "settlement_penalty_minor" BIGINT,
    "settlement_fee_minor" BIGINT,
    "settled_at" TIMESTAMP(3),
    "escrow_id" TEXT,
    "custody_id" TEXT,
    "adoption_id" TEXT,
    "external_ref" TEXT,
    "tx_hash" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_minor_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "payments_refunded_amount_range" CHECK ("refunded_amount_minor" >= 0 AND "refunded_amount_minor" <= "amount_minor"),
    CONSTRAINT "payments_fee_rate_bps_range" CHECK ("fee_rate_bps" >= 0 AND "fee_rate_bps" <= 10000)
);

CREATE TABLE "payment_lines" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "direction" "PaymentLineDirection" NOT NULL,
    "type" "PaymentLineType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_lines_amount_minor_positive" CHECK ("amount_minor" > 0)
);

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "external_ref" TEXT,
    "tx_hash" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_minor_positive" CHECK ("amount_minor" > 0)
);

CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "receipt_number" BIGINT NOT NULL,
    "verification_code" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipts_receipt_number_positive" CHECK ("receipt_number" > 0)
);

-- ─── Indexes & uniques ───────────────────────────────────

CREATE INDEX "payment_quotes_user_id_created_at_idx" ON "payment_quotes"("user_id", "created_at");

CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_escrow_id_idx" ON "payments"("escrow_id");
CREATE INDEX "payments_custody_id_idx" ON "payments"("custody_id");
CREATE INDEX "payments_adoption_id_idx" ON "payments"("adoption_id");
CREATE UNIQUE INDEX "payments_external_ref_key" ON "payments"("external_ref");

CREATE INDEX "payment_lines_payment_id_idx" ON "payment_lines"("payment_id");

CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");
CREATE UNIQUE INDEX "refunds_external_ref_key" ON "refunds"("external_ref");

CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");
CREATE UNIQUE INDEX "receipts_receipt_number_key" ON "receipts"("receipt_number");
CREATE UNIQUE INDEX "receipts_verification_code_key" ON "receipts"("verification_code");

-- ─── Foreign keys ────────────────────────────────────────

ALTER TABLE "payment_quotes" ADD CONSTRAINT "payment_quotes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_escrow_id_fkey"
    FOREIGN KEY ("escrow_id") REFERENCES "escrows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_custody_id_fkey"
    FOREIGN KEY ("custody_id") REFERENCES "custodies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_adoption_id_fkey"
    FOREIGN KEY ("adoption_id") REFERENCES "adoptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Immutability guards ─────────────────────────────────
--
-- A paid payment may only change its status, refund accounting and
-- settlement snapshot. Financial identity (payer, purpose, amount, currency,
-- fee snapshot, linked entities, external ref, tx hash, paid time) is frozen.
-- Only PENDING/FAILED payments may be deleted.

CREATE OR REPLACE FUNCTION "payments_immutable_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" NOT IN ('PENDING', 'FAILED') THEN
      RAISE EXCEPTION 'Payment % is immutable once paid: delete is not permitted', OLD."id"
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') THEN
    IF NEW."user_id" IS DISTINCT FROM OLD."user_id"
       OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
       OR NEW."amount_minor" IS DISTINCT FROM OLD."amount_minor"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."fee_rate_bps" IS DISTINCT FROM OLD."fee_rate_bps"
       OR NEW."fee_minor" IS DISTINCT FROM OLD."fee_minor"
       OR NEW."escrow_id" IS DISTINCT FROM OLD."escrow_id"
       OR NEW."custody_id" IS DISTINCT FROM OLD."custody_id"
       OR NEW."adoption_id" IS DISTINCT FROM OLD."adoption_id"
       OR NEW."external_ref" IS DISTINCT FROM OLD."external_ref"
       OR NEW."tx_hash" IS DISTINCT FROM OLD."tx_hash"
       OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Payment % is immutable once paid: only refunds may change it', OLD."id"
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_immutable_guard"
BEFORE UPDATE OR DELETE ON "payments"
FOR EACH ROW
EXECUTE FUNCTION "payments_immutable_guard"();

-- Ledger lines are append-only: they can never be rewritten or removed.

CREATE OR REPLACE FUNCTION "payment_lines_append_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PaymentLine records are append-only: % is not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "payment_lines_append_only_guard"
BEFORE UPDATE OR DELETE ON "payment_lines"
FOR EACH ROW
EXECUTE FUNCTION "payment_lines_append_only_guard"();

-- Refunds are immutable records; correcting a refund means issuing another one.

CREATE OR REPLACE FUNCTION "refunds_immutable_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Refund records are immutable: % is not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "refunds_immutable_guard"
BEFORE UPDATE OR DELETE ON "refunds"
FOR EACH ROW
EXECUTE FUNCTION "refunds_immutable_guard"();
