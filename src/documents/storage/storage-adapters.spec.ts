import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudinaryStorageAdapter } from './cloudinary-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { runStorageProviderConformanceTests } from './storage.conformance';
import * as path from 'path';
import * as fs from 'fs';

describe('Storage Adapters Conformance', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = path.join(process.cwd(), 'test-s3-conformance');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  const mockCloudinaryService = {
    uploadDocument: jest.fn().mockResolvedValue({
      public_id: 'doc_123',
      secure_url: 'https://cdn.example.com/doc.pdf',
    }),
    destroyAsset: jest.fn().mockResolvedValue(true),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'S3_LOCAL_STORAGE_DIR') return tempDir;
      if (key === 'JWT_SECRET') return 'test-secret';
      return null;
    }),
  };

  runStorageProviderConformanceTests('CloudinaryStorageAdapter', () => {
    return new CloudinaryStorageAdapter(mockCloudinaryService as unknown as CloudinaryService);
  });

  runStorageProviderConformanceTests('S3StorageAdapter', () => {
    return new S3StorageAdapter(mockConfigService as unknown as ConfigService);
  });
});
