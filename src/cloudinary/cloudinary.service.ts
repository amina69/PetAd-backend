import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  async uploadImage(
    buffer: Buffer,
    folder = 'pets',
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) {
            return reject(new Error('Cloudinary upload failed'));
          }
          if (!result) {
            return reject(new Error('Cloudinary upload failed with no result'));
          }
          return resolve(result);
        },
      );

      uploadStream.end(buffer);
    });
  }
  /**
   * Upload an avatar. The asset is re-encoded by Cloudinary and embedded
   * metadata (EXIF/GPS) is stripped from the delivered image, so a client
   * cannot smuggle profile data through an avatar upload.
   */
  async uploadAvatar(
    buffer: Buffer,
    folder = 'users',
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          // Normalise the image through a delivery transformation and strip
          // all embedded profiles/metadata (EXIF, IPTC, GPS, XMP).
          transformation: [
            {
              width: 1024,
              height: 1024,
              crop: 'limit',
              quality: 'auto:good',
              fetch_format: 'auto',
            },
          ],
          flags: 'strip_profile',
          image_metadata: false,
          invalidate: true,
        },
        (error, result) => {
          if (error) {
            return reject(new Error('Cloudinary avatar upload failed'));
          }
          if (!result) {
            return reject(
              new Error('Cloudinary avatar upload returned no result'),
            );
          }
          return resolve(result);
        },
      );

      uploadStream.end(buffer);
    });
  }

  /**
   * Permanently remove an asset from Cloudinary.
   *
   * Returns `true` when the asset is gone (deleted or already absent) and
   * throws when Cloudinary rejects the call, so callers can decide whether
   * the failure is fatal.
   */
  async destroyAsset(
    publicId: string,
    resourceType: 'image' | 'raw' = 'image',
  ): Promise<boolean> {
    const result = (await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    })) as { result?: string };
    return result.result === 'ok' || result.result === 'not found';
  }

  async uploadDocument(
    buffer: Buffer,
    folder = 'documents',
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'raw',
        },
        (error, result) => {
          if (error) {
            return reject(new Error('Cloudinary document upload failed'));
          }
          if (!result) {
            return reject(new Error('Cloudinary upload returned no result'));
          }
          return resolve(result);
        },
      );

      uploadStream.end(buffer);
    });
  }
}
