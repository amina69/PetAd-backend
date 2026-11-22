-- Add encrypted PII fields for field-level encryption (issue #381)
-- These columns store encrypted data as JSON blobs;
-- encryption/decryption is handled by PiiEncryptionService.
--
-- The actual encryption is performed at the application layer before
-- persisting to the database, so the stored values are base64-encoded
-- {iv, data, authTag} objects.

-- Add encrypted email column (stores {iv, data, authTag} JSON)
ALTER TABLE "users" ADD COLUMN "encrypted_email" JSON;

-- Add encrypted phone column (stores {iv, data, authTag} JSON)
ALTER TABLE "users" ADD COLUMN "encrypted_phone" JSON;

-- Add encrypted bio column (stores {iv, data, authTag} JSON)
ALTER TABLE "users" ADD COLUMN "encrypted_bio" JSON;