import { InternalServerErrorException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReceiptStorageService } from './receipt-storage.service';

describe('ReceiptStorageService', () => {
  let directory: string;
  let service: ReceiptStorageService;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'petad-receipts-'));
    service = new ReceiptStorageService({
      get: <T>(key: string, fallback?: T): T | undefined =>
        key === 'payments.receiptDir' ? (directory as unknown as T) : fallback,
    } as never);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('writes a private file and reads it back', async () => {
    const contents = Buffer.from('%PDF-1.7 test');
    const filePath = await service.write('payment-1', contents);

    expect(filePath).toBe(path.join(directory, 'payment-1.pdf'));
    expect((await service.read(filePath)).equals(contents)).toBe(true);

    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o077).toBe(0);
  });

  it('rejects reads outside the configured directory', async () => {
    await expect(service.read('/etc/passwd')).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
