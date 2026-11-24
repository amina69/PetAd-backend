/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      document: { findFirst: jest.fn(), update: jest.fn() },
      adoption: { findUnique: jest.fn() },
      escrow: { findUnique: jest.fn() },
      adoptionFindMany: jest.fn(),
    };

    service = new DocumentsService(
      prisma,
      {} as any,
      { get: jest.fn().mockReturnValue('test-secret') } as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects expired signed download links', async () => {
    const expired = Math.floor(Date.now() / 1000) - 10;

    await expect(
      service.downloadSigned('document-1', String(expired), 'sig'),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects tampered download signatures', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      fileName: 'proof.pdf',
      mimeType: 'application/pdf',
      fileUrl: 'https://cdn.example.com/proof.pdf',
    });

    await expect(
      service.downloadSigned(
        'document-1',
        String(Math.floor(Date.now() / 1000) + 60),
        'not-the-signature',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('issues a working short-lived URL from /download-url', async () => {
    prisma.document.findFirst.mockResolvedValue({ id: 'document-1' });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(Buffer.from('file-bytes'), { status: 200 }) as any,
      );

    const signed = await service.createDownloadUrl(
      'document-1',
      'https://api.example.test',
      120,
    );

    expect(signed.expiresIn).toBe(120);

    const url = new URL(signed.url);
    const expires = url.searchParams.get('expires') as string;
    const sig = url.searchParams.get('sig') as string;

    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      fileName: 'proof.pdf',
      mimeType: 'application/pdf',
      fileUrl: 'https://cdn.example.com/proof.pdf',
    });

    const result = await service.downloadSigned('document-1', expires, sig);

    expect(result.body.toString()).toBe('file-bytes');
  });

  it('blocks deleting a document attached to an open dispute', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      entityType: 'DISPUTE',
      entityId: 'dispute-1',
      adoptionId: null,
    });
    prisma.escrow.findUnique.mockResolvedValue({ status: 'DISPUTED' });

    await expect(service.remove('document-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.document.update).not.toHaveBeenCalled();
  });
});
