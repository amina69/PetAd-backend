import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrivateStorageService } from './private-storage.service';

describe('PrivateStorageService', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petad-private-'));
  let service: PrivateStorageService;

  beforeAll(() => {
    const config = {
      get: jest.fn().mockReturnValue(root),
    } as unknown as ConfigService;
    service = new PrivateStorageService(config);
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('saves files under the configured directory after sanitizing the name', async () => {
    const saved = await service.saveFile(
      '../../../evil.pdf',
      Buffer.from('%PDF-'),
    );
    expect(path.dirname(saved)).toBe(root);
    expect(path.basename(saved)).toBe('evil.pdf');
    await fs.promises.unlink(saved);
  });

  it('rejects traversal reads before reaching the filesystem layer', async () => {
    const readFile = jest.spyOn(fs.promises, 'readFile');
    await expect(service.readFile('../secret.txt')).rejects.toThrow(
      BadRequestException,
    );
    expect(readFile).not.toHaveBeenCalled();
    readFile.mockRestore();
  });

  it('rejects traversal streams before reaching the filesystem layer', () => {
    expect(() => service.createReadStream('../../etc/passwd')).toThrow(
      BadRequestException,
    );
  });
});
