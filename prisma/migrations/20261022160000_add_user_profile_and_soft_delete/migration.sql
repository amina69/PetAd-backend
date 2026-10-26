-- Profile fields exposed by PATCH /users/:id, avatar asset tracking for
-- Cloudinary deletion, and the soft-delete marker used by
-- DELETE /users/:id. PII columns (name, password) become nullable so an
-- anonymised account keeps its row for referential integrity without
-- retaining personal data.
--
-- The UserStatus enum and the users.status / users.deleted_at columns are
-- created by 20261022120000_add_account_suspension and
-- 20261022131500_add_data_export_and_user_status.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'USER_DELETED';

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "avatar_public_id" TEXT,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "phone" TEXT,
  ALTER COLUMN "password" DROP NOT NULL,
  ALTER COLUMN "first_name" DROP NOT NULL,
  ALTER COLUMN "last_name" DROP NOT NULL;
