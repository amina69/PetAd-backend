import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events/events.service';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { EventLedgerService } from '../event-ledger/event-ledger.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException, ForbiddenException, UnsupportedMediaTypeException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: PrismaService;
  let cloudinary: CloudinaryService;
  let eventLedger: EventLedgerService;
  let config: ConfigService;

  const mockPrismaService = {
    document: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    adoption: {
      findUnique: jest.fn(),
    },
    custody: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockCloudinaryService = {
    uploadDocument: jest.fn().mockResolvedValue({ secure_url: 'https://cloudinary.com/doc.pdf', public_id: 'doc_123' }),
    destroyAsset: jest.fn().mockResolvedValue(true),
  };

  const mockEventsService = {
    logEvent: jest.fn().mockResolvedValue({ id: 'event-1' }),
  };

  const mockEventLedgerService = {
    recordEvent: jest.fn().mockResolvedValue({ id: 'event-1' }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: EventLedgerService, useValue: mockEventLedgerService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    prisma = module.get<PrismaService>(PrismaService);
    cloudinary = module.get<CloudinaryService>(CloudinaryService);
    eventLedger = module.get<EventLedgerService>(EventLedgerService);
    config = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Validators and Hashing', () => {
    it('should calculate SHA-256 hash correctly', () => {
      const buffer = Buffer.from('test document content');
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const hash = service.calculateHash(buffer);
      expect(hash).toEqual(expectedHash);
    });
  });

  describe('Signed URL expiry and verification', () => {
    it('should generate a valid signed download URL and verify it', async () => {
      const docId = 'doc-uuid-1';
      mockPrismaService.document.findUnique.mockResolvedValue({
        id: docId,
        url: 'https://cloudinary.com/doc.pdf',
        scanStatus: 'CLEAN',
      });

      const signedUrl = await service.generateSignedDownloadUrl(docId, 3600);
      expect(signedUrl).toContain('signature=');
      expect(signedUrl).toContain('expires=');

      // Extract query params
      const urlObj = new URL(signedUrl);
      const signature = urlObj.searchParams.get('signature');
      const expires = urlObj.searchParams.get('expires');

      const isValid = service.verifySignedUrl(docId, Number(expires), signature!);
      expect(isValid).toBe(true);
    });

    it('should reject expired signed URL', async () => {
      const docId = 'doc-uuid-1';
      const pastTime = Math.floor(Date.now() / 1000) - 10;
      const isValid = service.verifySignedUrl(docId, pastTime, 'somesig');
      expect(isValid).toBe(false);
    });
  });

  describe('Scanning gate & verification flow', () => {
    it('should block download if document scanStatus is not CLEAN', async () => {
      const docId = 'doc-uuid-2';
      mockPrismaService.document.findUnique.mockResolvedValue({
        id: docId,
        url: 'https://cloudinary.com/doc.pdf',
        scanStatus: 'INFECTED',
      });

      await expect(service.generateSignedDownloadUrl(docId, 3600)).rejects.toThrow(BadRequestException);
    });
  });

  describe('Access policy and retention', () => {
    it('should enforce access policy when retrieving documents', async () => {
      mockPrismaService.document.findUnique.mockResolvedValue({
        id: 'doc-uuid-3',
        uploadedById: 'owner-1',
        adoptionId: 'adoption-1',
      });

      mockPrismaService.adoption.findUnique.mockResolvedValue({
        id: 'adoption-1',
        adopterId: 'adopter-1',
        ownerId: 'owner-1',
      });

      const hasAccess = await service.checkAccess('adopter-1', 'USER', 'doc-uuid-3');
      expect(hasAccess).toBe(false);

      const noAccess = await service.checkAccess('stranger-1', 'USER', 'doc-uuid-3');
      expect(noAccess).toBe(false);

      const adminAccess = await service.checkAccess('admin-1', 'ADMIN', 'doc-uuid-3');
      expect(adminAccess).toBe(true);
    });
  });
});
