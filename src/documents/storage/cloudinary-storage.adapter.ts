import { Injectable } from '@nestjs/common';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { StorageProvider, PutOptions, PutResult } from './storage-provider.interface';

@Injectable()
export class CloudinaryStorageAdapter implements StorageProvider {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  async put(buffer: Buffer, key: string, options?: PutOptions): Promise<PutResult> {
    const folder = options?.kind ? `documents/${options.kind}` : 'documents';
    const res = await this.cloudinaryService.uploadDocument(buffer, folder);
    return {
      key: res.public_id,
      url: res.secure_url,
      provider: 'cloudinary',
    };
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    // Cloudinary public URLs for public assets or default passthrough
    return key;
  }

  async delete(key: string): Promise<boolean> {
    return this.cloudinaryService.destroyAsset(key, 'raw');
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.cloudinaryService.getAssetDetails(key);
      return true;
    } catch {
      return false;
    }
  }
}
