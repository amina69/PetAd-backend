/*
  Warnings:

  - You are about to drop the column `status` on the `pets` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "pets_status_idx";

-- AlterTable
ALTER TABLE "pets" DROP COLUMN "status";

-- DropEnum
DROP TYPE "PetStatus";
