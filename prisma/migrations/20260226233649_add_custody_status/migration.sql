/*
  Warnings:

  - You are about to drop the column `gender` on the `pets` table. All the data in the column will be lost.
  - You are about to drop the column `size` on the `pets` table. All the data in the column will be lost.
  - You are about to drop the `documents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_adoption_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_uploaded_by_id_fkey";

-- AlterTable
ALTER TABLE "pets" DROP COLUMN "gender",
DROP COLUMN "size";

-- DropTable
DROP TABLE "documents";

-- DropEnum
DROP TYPE "PetGender";

-- DropEnum
DROP TYPE "PetSize";
