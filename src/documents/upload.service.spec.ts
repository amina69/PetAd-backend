import { ConfigService } from '@nestjs/config';
import { UploadService } from './upload.service';

function pdf(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'binary');
}

function png(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000a49444154789c6300010000050001',
    'hex',
  );
}

function exe(): Buffer {
  return Buffer.from(
    'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff',
    'binary',
  );
}

function service(maxFileSize = 10 * 1024 * 1024): UploadService {
  const config = {
    get: jest.fn((key: string) =>
      key === 'upload.maxFileSize' ? maxFileSize : undefined,
    ),
  };
  return new UploadService(config as unknown as ConfigService);
}

describe('UploadService', () => {
  it('rejects a zero-byte file with EMPTY_FILE', async () => {
    await expect(
      service().validate({
        buffer: Buffer.alloc(0),
        size: 0,
        originalname: 'empty.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'EMPTY_FILE' });
  });

  it('rejects a file over the configured limit with TOO_LARGE', async () => {
    await expect(
      service(10).validate({
        buffer: Buffer.from('some payload'),
        originalname: 'big.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('rejects an .exe renamed to .pdf with WRONG_TYPE', async () => {
    await expect(
      service().validate({
        buffer: exe(),
        originalname: 'invoice.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_TYPE' });
  });

  it('rejects content whose declared MIME does not match', async () => {
    await expect(
      service().validate({
        buffer: pdf(),
        originalname: 'document.pdf',
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_TYPE' });
  });

  it('rejects content whose declared extension does not match', async () => {
    await expect(
      service().validate({
        buffer: png(),
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_TYPE' });
  });

  it('rejects encrypted PDFs', async () => {
    const encrypted = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('trailer\n<< /Encrypt 4 0 R >>\n%%EOF'),
    ]);

    await expect(
      service().validate({
        buffer: encrypted,
        originalname: 'protected.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_TYPE' });
  });

  it('rejects an SVG containing a script', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    await expect(
      service().validate(
        {
          buffer: svg,
          originalname: 'logo.svg',
          mimetype: 'image/svg+xml',
        },
        'image',
      ),
    ).rejects.toMatchObject({ code: 'WRONG_TYPE' });
  });

  it('rejects a shebang script payload', async () => {
    await expect(
      service().validate({
        buffer: Buffer.from('#!/bin/sh\nrm -rf /'),
        originalname: 'notes.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'WRONG_TYPE' });
  });

  it('neutralises path traversal file names', async () => {
    const result = await service().validate({
      buffer: pdf(),
      originalname: '../../etc/passwd',
      mimetype: 'application/pdf',
    });

    expect(result.displayName).toBe('passwd.pdf');
    expect(result.displayName).not.toContain('..');
    expect(result.displayName).not.toContain('/');
    expect(result.storageKey).not.toContain('passwd');
    expect(result.storageKey).not.toContain('..');
  });

  it('strips control characters and windows paths from names', async () => {
    const result = await service().validate({
      buffer: pdf(),
      originalname: 'C:\\Users\\evil\\..\\contract\u0000\u0007.pdf',
      mimetype: 'application/pdf',
    });

    expect(result.displayName).toBe('contract.pdf');
  });

  it('accepts a valid PDF and returns a random storage key', async () => {
    const first = await service().validate({
      buffer: pdf(),
      originalname: 'adoption-form.pdf',
      mimetype: 'application/pdf',
    });
    const second = await service().validate({
      buffer: pdf(),
      originalname: 'adoption-form.pdf',
      mimetype: 'application/pdf',
    });

    expect(first.mimeType).toBe('application/pdf');
    expect(first.displayName).toBe('adoption-form.pdf');
    expect(first.storageKey).toMatch(/^[a-f0-9-]{36}\.pdf$/);
    expect(first.storageKey).not.toBe(second.storageKey);
  });
});
