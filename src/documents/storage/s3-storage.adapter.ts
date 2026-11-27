import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider, PutOptions, PutResult } from './storage-provider.interface';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class S3StorageAdapter implements StorageProvider {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly storageDir: string;

  constructor(private readonly configService: ConfigService) {
    const configuredDir = this.configService.get<string>('S3_LOCAL_STORAGE_DIR');
    this.storageDir = configuredDir
      ? path.resolve(configuredDir)
      : path.join(process.cwd(), 'storage', 'private', 's3');

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async put(buffer: Buffer, key: string, options?: PutOptions): Promise<PutResult> {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    const sanitizedKey = key.replace(/[^a-zA-Z0-9-_./]/g, '_');
    const fullPath = path.join(this.storageDir, sanitizedKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
    this.logger.log(`Stored encrypted sensitive object with S3-compatible adapter: ${sanitizedKey}`);
    return {
      key: sanitizedKey,
      url: `/documents/s3/${sanitizedKey}`,
      provider: 's3',
    };
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const expires = Date.now() + expiresInSeconds * 1000;
    const secret = this.configService.get<string>('JWT_SECRET') || 'secret';
    const signature = crypto.createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex');
    return `/documents/signed/${encodeURIComponent(key)}?expires=${expires}&sig=${signature}`;
  }

  async delete(key: string): Promise<boolean> {
    const sanitizedKey = key.replace(/[^a-zA-Z0-9-_./]/g, '_');
    const fullPath = path.join(this.storageDir, sanitizedKey);
    try {
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        return true;
      }
    } catch (e) {
      this.logger.error(`Failed to delete S3 object ${key}: ${e}`);
    }
    return true;
  }

  async exists(key: string): Promise<boolean> {
    const sanitizedKey = key.replace(/[^a-zA-Z0-9-_./]/g, '_');
    const fullPath = path.join(this.storageDir, sanitizedKey);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
