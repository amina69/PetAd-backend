/*
  Warnings:

  - The `status` column on the `pets` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PetStatus" AS ENUM ('AVAILABLE', 'PENDING', 'IN_CUSTODY', 'ADOPTED');

-- CreateEnum
CREATE TYPE "PetGender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "PetSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- AlterTable
ALTER TABLE "pets" ADD COLUMN     "gender" "PetGender",
ADD COLUMN     "size" "PetSize",
DROP COLUMN "status",
ADD COLUMN     "status" "PetStatus" NOT NULL DEFAULT 'AVAILABLE';

-- CreateIndex
CREATE INDEX "pets_status_idx" ON "pets"("status");
