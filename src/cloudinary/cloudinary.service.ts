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
