import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PrivateStorageService {
  private readonly logger = new Logger(PrivateStorageService.name);
  private readonly storageDir: string;

  constructor(private readonly configService: ConfigService) {
    const configuredDir = this.configService.get<string>(
      'DATA_EXPORT_STORAGE_DIR',
    );
    this.storageDir = configuredDir
      ? path.resolve(configuredDir)
      : path.join(process.cwd(), 'storage', 'private', 'exports');

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  getStorageDirectory(): string {
    return this.storageDir;
  }

  async saveFile(fileName: string, buffer: Buffer): Promise<string> {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    const fullPath = path.join(this.storageDir, fileName);
    await fs.promises.writeFile(fullPath, buffer);
    return fullPath;
  }

  async readFile(filePath: string): Promise<Buffer> {
    return fs.promises.readFile(filePath);
  }

  createReadStream(filePath: string): fs.ReadStream {
    return fs.createReadStream(filePath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      if (await this.fileExists(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`Purged private file: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete private file ${filePath}: ${error}`);
    }
  }
}
