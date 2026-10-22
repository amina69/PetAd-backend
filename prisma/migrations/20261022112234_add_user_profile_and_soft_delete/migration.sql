-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DELETED');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'USER_DELETED';

-- AlterTable
-- Profile fields exposed by PATCH /users/:id, avatar asset tracking for
-- Cloudinary deletion, and the soft-delete marker used by
-- DELETE /users/:id. PII columns (name, password) become nullable so an
-- anonymised account keeps its row for referential integrity without
-- retaining personal data.
ALTER TABLE "users"
  ADD COLUMN "avatar_public_id" TEXT,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "location" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ALTER COLUMN "password" DROP NOT NULL,
  ALTER COLUMN "first_name" DROP NOT NULL,
  ALTER COLUMN "last_name" DROP NOT NULL;
