import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Private, filesystem-backed storage for receipt PDFs.
 *
 * Files are never served statically: the only way to read one is through a
 * signed, expiring download URL. Writes are atomic (temp file + rename) and
 * restricted to the configured receipt directory.
 */
@Injectable()
export class ReceiptStorageService {
  constructor(private readonly config: ConfigService) {}

  get directory(): string {
    return this.config.get<string>('payments.receiptDir', './storage/receipts');
  }

  async write(paymentId: string, contents: Buffer): Promise<string> {
    const directory = path.resolve(this.directory);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });

    const filePath = path.join(directory, `${paymentId}.pdf`);
    const tempPath = path.join(directory, `.${paymentId}.${randomUUID()}.tmp`);

    try {
      await fs.writeFile(tempPath, contents, { mode: 0o600 });
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return filePath;
  }

  async read(filePath: string): Promise<Buffer> {
    const resolved = this.resolveSafePath(filePath);
    return fs.readFile(resolved);
  }

  private resolveSafePath(filePath: string): string {
    const directory = path.resolve(this.directory);
    const resolved = path.resolve(filePath);

    if (
      resolved !== directory &&
      !resolved.startsWith(`${directory}${path.sep}`)
    ) {
      throw new InternalServerErrorException(
        'Receipt storage path escaped the configured directory',
      );
    }

    return resolved;
  }
}
