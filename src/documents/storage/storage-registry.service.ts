import { Injectable, BadRequestException } from '@nestjs/common';
import { StorageProvider } from './storage-provider.interface';
import { CloudinaryStorageAdapter } from './cloudinary-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

@Injectable()
export class StorageRegistryService {
  constructor(
    private readonly cloudinaryAdapter: CloudinaryStorageAdapter,
    private readonly s3Adapter: S3StorageAdapter,
  ) {}

  getProvider(kind?: string): StorageProvider {
    const sensitiveKinds = ['IDENTITY_DOCUMENT', 'PROOF_OF_ADDRESS', 'ID', 'ADDRESS'];
    if (kind && sensitiveKinds.includes(kind.toUpperCase())) {
      return this.s3Adapter;
    }
    return this.cloudinaryAdapter;
  }

  getProviderByName(name: string): StorageProvider {
    if (name === 's3') {
      return this.s3Adapter;
    }
    return this.cloudinaryAdapter;
  }
}
