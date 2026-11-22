import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

/**
 * Field-level encryption service for PII protection.
 * Uses AES-256-GCM with a key derived from the ENV encryption key.
 * 
 * Fields that should be encrypted:
 * - user.email (at rest)
 * - user.phone
 * - user.bio
 * - Any other sensitive PII fields
 * 
 * Encrypted storage format: {iv:base64, data:base64, authTag:base64}
 */
@Injectable()
export class PiiEncryptionService {
  private readonly logger = new Logger(PiiEncryptionService.name);
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    // Get the encryption key from env (must be at least 32 chars; derived via SHA-256 for AES-256-GCM)
    const rawKey = configService.get<string>('PIPI_ENCRYPTION_KEY');
    if (!rawKey) {
      this.logger.warn(
        'PIPI_ENCRYPTION_KEY not configured; PII encryption will use empty key (dev only)',
      );
      this.key = Buffer.alloc(32, 0);
    } else {
      // Derive a 256-bit key using SHA-256 hash of the raw key
      const hashedKey = crypto.hash('sha256', rawKey);
      this.key = Buffer.from(hashedKey); // Ensure it's a Buffer
    }

    // IV length for AES-GCM is 12 bytes (96 bits) per best practices.
    this.ivLength = 12;
  }

  private ivLength: number;

/**
 * Encrypt a plaintext string.
 * Returns an object with iv and encrypted data (both base64-encoded) and the auth tag.
 */
  encrypt(plaintext: string): { iv: string; data: string; authTag: string } {
    if (!plaintext) {
      return { iv: '', data: '', authTag: '' };
    }

    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const authTag = cipher.getAuthTag().toString('base64');

      return { iv: iv.toString('base64'), data: encrypted, authTag };
    } catch (error) {
      this.logger.error(`PII encryption failed: ${(error as Error).message}`);
      throw error;
    }
  }

/**
 * Decrypt ciphertext that was encrypted by encrypt().
 * The input should have iv, data, and authTag as base64 strings.
 */
  decrypt(encryptedData: { iv: string; data: string; authTag: string }): string {
    if (!encryptedData.iv || !encryptedData.data) {
      return '';
    }

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(encryptedData.iv, 'base64'),
      );
      // Set the auth tag before calling update
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'base64'));
      let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      this.logger.error(`PII decryption failed: ${(error as Error).message}`);
      throw error;
    }
  }

/**
 * Encrypt a user's PII fields and return the encrypted values.
 * Returns an object with the encrypted field names as keys.
 */
  encryptUserPii(
    user: {
      email?: string;
      phone?: string;
      bio?: string;
    },
  ): {
    email?: { iv: string; data: string; authTag: string };
    phone?: { iv: string; data: string; authTag: string };
    bio?: { iv: string; data: string; authTag: string };
  } {
    const result: {
      email?: { iv: string; data: string; authTag: string };
      phone?: { iv: string; data: string; authTag: string };
      bio?: { iv: string; data: string; authTag: string };
    } = {};

    if (user.email) {
      result.email = this.encrypt(user.email);
    }
    if (user.phone) {
      result.phone = this.encrypt(user.phone);
    }
    if (user.bio) {
      result.bio = this.encrypt(user.bio);
    }

    return result;
  }

/**
 * Decrypt user PII fields from their encrypted representations.
 */
  decryptUserPii(
    encrypted: {
      email?: { iv: string; data: string; authTag: string };
      phone?: { iv: string; data: string; authTag: string };
      bio?: { iv: string; data: string; authTag: string };
    },
  ): {
    email?: string;
    phone?: string;
    bio?: string;
  } {
    const result: {
      email?: string;
      phone?: string;
      bio?: string;
    } = {};

    if (encrypted?.email) {
      result.email = this.decrypt(encrypted.email);
    }
    if (encrypted?.phone) {
      result.phone = this.decrypt(encrypted.phone);
    }
    if (encrypted?.bio) {
      result.bio = this.decrypt(encrypted.bio);
    }

    return result;
  }
}