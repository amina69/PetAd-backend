import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataExportService } from './data-export.service';
import { PrivateStorageService } from './private-storage.service';
import { DataExportQueueService } from './data-export-queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DataExportStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

describe('DataExportService', () => {
  let service: DataExportService;
  let tempStorageDir: string;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    adoption: {
      findMany: jest.fn(),
    },
    custody: {
      findMany: jest.fn(),
    },
    document: {
      findMany: jest.fn(),
    },
    eventLog: {
      findMany: jest.fn(),
    },
    dataExport: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockQueueService = {
    enqueueDataExport: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-super-secret-key';
      if (key === 'DATA_EXPORT_STORAGE_DIR') return tempStorageDir;
      return null;
    }),
  };

  beforeAll(() => {
    tempStorageDir = path.join(process.cwd(), 'test-exports-storage');
    if (!fs.existsSync(tempStorageDir)) {
      fs.mkdirSync(tempStorageDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (fs.existsSync(tempStorageDir)) {
      await fs.promises.rm(tempStorageDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportService,
        PrivateStorageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DataExportQueueService, useValue: mockQueueService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DataExportService>(DataExportService);
  });

  describe('requestDataExport', () => {
    it('enqueues export and returns 202 payload if no active request exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'ACTIVE',
        deletedAt: null,
      });
      mockPrisma.dataExport.findFirst.mockResolvedValue(null);
      mockPrisma.dataExport.create.mockResolvedValue({
        id: 'export-1',
        userId: 'user-1',
        status: DataExportStatus.PENDING,
      });

      const result = await service.requestDataExport('user-1');

      expect(mockPrisma.dataExport.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: {
            in: [DataExportStatus.PENDING, DataExportStatus.PROCESSING],
          },
        },
      });
      expect(mockPrisma.dataExport.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          status: DataExportStatus.PENDING,
        },
      });
      expect(mockQueueService.enqueueDataExport).toHaveBeenCalledWith({
        exportId: 'export-1',
        userId: 'user-1',
      });
      expect(result.id).toBe('export-1');
      expect(result.status).toBe(DataExportStatus.PENDING);
    });

    it('rejects with ConflictException (409) if an active request is already in progress', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'ACTIVE',
        deletedAt: null,
      });
      mockPrisma.dataExport.findFirst.mockResolvedValue({
        id: 'existing-export',
        userId: 'user-1',
        status: DataExportStatus.PROCESSING,
      });

      await expect(service.requestDataExport('user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects with NotFoundException if user is suspended or deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'SUSPENDED',
        deletedAt: null,
      });

      await expect(service.requestDataExport('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Acceptance Criteria: Export contains only the requester data (test with two users)', () => {
    const userA = {
      id: 'user-a',
      email: 'usera@example.com',
      firstName: 'User',
      lastName: 'A',
      role: 'USER',
      status: 'ACTIVE',
      trustScore: 70,
      stellarPublicKey: 'G_USER_A',
      avatarUrl: 'https://example.com/a.jpg',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      deletedAt: null,
    };

    const userB = {
      id: 'user-b',
      email: 'userb@example.com',
      firstName: 'User',
      lastName: 'B',
      role: 'USER',
      status: 'ACTIVE',
      trustScore: 80,
      stellarPublicKey: 'G_USER_B',
      avatarUrl: 'https://example.com/b.jpg',
      createdAt: new Date('2026-01-03'),
      updatedAt: new Date('2026-01-04'),
      deletedAt: null,
    };

    const adoptionA = {
      id: 'adoption-a',
      adopterId: 'user-a',
      ownerId: 'shelter-1',
      petId: 'pet-a',
      status: 'COMPLETED',
      pet: { id: 'pet-a', name: 'Buddy' },
      escrow: null,
      documents: [{ id: 'doc-meta-a', fileName: 'contract-a.pdf' }],
    };

    const adoptionB = {
      id: 'adoption-b',
      adopterId: 'user-b',
      ownerId: 'shelter-2',
      petId: 'pet-b',
      status: 'COMPLETED',
      pet: { id: 'pet-b', name: 'Milo' },
      escrow: null,
      documents: [{ id: 'doc-meta-b', fileName: 'contract-b.pdf' }],
    };

    const custodyA = {
      id: 'custody-a',
      holderId: 'user-a',
      petId: 'pet-a',
      status: 'COMPLETED',
      pet: { id: 'pet-a', name: 'Buddy' },
      escrow: null,
    };

    const custodyB = {
      id: 'custody-b',
      holderId: 'user-b',
      petId: 'pet-b',
      status: 'COMPLETED',
      pet: { id: 'pet-b', name: 'Milo' },
      escrow: null,
    };

    const documentA = {
      id: 'doc-a',
      fileName: 'id-a.png',
      mimeType: 'image/png',
      size: 1024,
      uploadedById: 'user-a',
      adoptionId: 'adoption-a',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const documentB = {
      id: 'doc-b',
      fileName: 'id-b.png',
      mimeType: 'image/png',
      size: 2048,
      uploadedById: 'user-b',
      adoptionId: 'adoption-b',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const eventA = {
      id: 'evt-a',
      actorId: 'user-a',
      eventType: 'USER_REGISTERED',
      payload: { note: 'A registered' },
    };

    const eventB = {
      id: 'evt-b',
      actorId: 'user-b',
      eventType: 'USER_REGISTERED',
      payload: { note: 'B registered' },
    };

    it('assembles and exports only User A data when User A requests export', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'user-a') return Promise.resolve(userA);
        if (where.id === 'user-b') return Promise.resolve(userB);
        return Promise.resolve(null);
      });

      mockPrisma.adoption.findMany.mockImplementation(({ where }) => {
        const isUserA = where?.OR?.some(
          (cond: any) =>
            cond.adopterId === 'user-a' || cond.ownerId === 'user-a',
        );
        if (isUserA) return Promise.resolve([adoptionA]);
        return Promise.resolve([adoptionB]);
      });

      mockPrisma.custody.findMany.mockImplementation(({ where }) => {
        if (where?.holderId === 'user-a') return Promise.resolve([custodyA]);
        return Promise.resolve([custodyB]);
      });

      mockPrisma.document.findMany.mockImplementation(({ where }) => {
        if (where?.uploadedById === 'user-a')
          return Promise.resolve([documentA]);
        return Promise.resolve([documentB]);
      });

      mockPrisma.eventLog.findMany.mockImplementation(({ where }) => {
        if (where?.actorId === 'user-a') return Promise.resolve([eventA]);
        return Promise.resolve([eventB]);
      });

      const exportA = await service.assembleUserData('user-a');

      // Assert User A has only User A's data
      expect(exportA.userId).toBe('user-a');
      expect(exportA.profile.id).toBe('user-a');
      expect(exportA.profile.email).toBe('usera@example.com');
      expect(exportA.adoptions).toHaveLength(1);
      expect(exportA.adoptions[0].id).toBe('adoption-a');
      expect(exportA.custody).toHaveLength(1);
      expect(exportA.custody[0].id).toBe('custody-a');
      expect(exportA.documents).toHaveLength(1);
      expect(exportA.documents[0].id).toBe('doc-a');
      expect(exportA.events).toHaveLength(1);
      expect(exportA.events[0].id).toBe('evt-a');

      // Assert NONE of User B's data is present in User A's export
      expect(JSON.stringify(exportA)).not.toContain('user-b');
      expect(JSON.stringify(exportA)).not.toContain('userb@example.com');
      expect(JSON.stringify(exportA)).not.toContain('adoption-b');
      expect(JSON.stringify(exportA)).not.toContain('custody-b');
      expect(JSON.stringify(exportA)).not.toContain('doc-b');
      expect(JSON.stringify(exportA)).not.toContain('evt-b');
      expect(exportA.profile).not.toHaveProperty('password');
    });

    it('assembles and exports only User B data when User B requests export', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'user-b') return Promise.resolve(userB);
        return Promise.resolve(null);
      });

      mockPrisma.adoption.findMany.mockImplementation(({ where }) => {
        const isUserB = where?.OR?.some(
          (cond: any) =>
            cond.adopterId === 'user-b' || cond.ownerId === 'user-b',
        );
        if (isUserB) return Promise.resolve([adoptionB]);
        return Promise.resolve([]);
      });

      mockPrisma.custody.findMany.mockImplementation(({ where }) => {
        if (where?.holderId === 'user-b') return Promise.resolve([custodyB]);
        return Promise.resolve([]);
      });

      mockPrisma.document.findMany.mockImplementation(({ where }) => {
        if (where?.uploadedById === 'user-b')
          return Promise.resolve([documentB]);
        return Promise.resolve([]);
      });

      mockPrisma.eventLog.findMany.mockImplementation(({ where }) => {
        if (where?.actorId === 'user-b') return Promise.resolve([eventB]);
        return Promise.resolve([]);
      });

      const exportB = await service.assembleUserData('user-b');

      // Assert User B has only User B's data
      expect(exportB.userId).toBe('user-b');
      expect(exportB.profile.id).toBe('user-b');
      expect(exportB.profile.email).toBe('userb@example.com');
      expect(exportB.adoptions).toHaveLength(1);
      expect(exportB.adoptions[0].id).toBe('adoption-b');
      expect(exportB.custody).toHaveLength(1);
      expect(exportB.custody[0].id).toBe('custody-b');
      expect(exportB.documents).toHaveLength(1);
      expect(exportB.documents[0].id).toBe('doc-b');
      expect(exportB.events).toHaveLength(1);
      expect(exportB.events[0].id).toBe('evt-b');

      // Assert NONE of User A's data is present in User B's export
      expect(JSON.stringify(exportB)).not.toContain('user-a');
      expect(JSON.stringify(exportB)).not.toContain('usera@example.com');
      expect(JSON.stringify(exportB)).not.toContain('adoption-a');
      expect(JSON.stringify(exportB)).not.toContain('custody-a');
      expect(JSON.stringify(exportB)).not.toContain('doc-a');
      expect(JSON.stringify(exportB)).not.toContain('evt-a');
    });
  });

  describe('Acceptance Criteria: Download link expires and the file is purged by the cleanup job', () => {
    it('generates short-lived signed URL for completed export', async () => {
      const now = new Date();
      const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      mockPrisma.dataExport.findUnique.mockResolvedValue({
        id: 'export-completed-1',
        userId: 'user-1',
        status: DataExportStatus.COMPLETED,
        filePath: path.join(tempStorageDir, 'export.zip'),
        fileSize: 5000,
        expiresAt: in7Days,
        createdAt: now,
      });

      const status = await service.getDataExportStatus(
        'export-completed-1',
        'user-1',
      );

      expect(status.status).toBe(DataExportStatus.COMPLETED);
      expect(status.downloadUrl).toBeDefined();
      expect(status.downloadUrl).toContain(
        '/users/me/data-export/export-completed-1/download',
      );
      expect(status.downloadUrl).toContain('expires=');
      expect(status.downloadUrl).toContain('sig=');
      expect(status.linkExpiresAt).toBeDefined();
    });

    it('rejects download when signed link has expired (short-lived expiry)', async () => {
      const expiredTimestamp = Date.now() - 10000; // 10 seconds in the past

      mockPrisma.dataExport.findUnique.mockResolvedValue({
        id: 'export-completed-1',
        userId: 'user-1',
        status: DataExportStatus.COMPLETED,
        filePath: path.join(tempStorageDir, 'export.zip'),
        fileSize: 5000,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await expect(
        service.getExportFileForDownload(
          'export-completed-1',
          expiredTimestamp,
          'any-sig',
          'user-1',
        ),
      ).rejects.toThrow(GoneException);
    });

    it('rejects download when signature is invalid or tampered', async () => {
      const futureTimestamp = Date.now() + 900000;

      mockPrisma.dataExport.findUnique.mockResolvedValue({
        id: 'export-completed-1',
        userId: 'user-1',
        status: DataExportStatus.COMPLETED,
        filePath: path.join(tempStorageDir, 'export.zip'),
        fileSize: 5000,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await expect(
        service.getExportFileForDownload(
          'export-completed-1',
          futureTimestamp,
          'invalid-tampered-signature',
          'user-1',
        ),
      ).rejects.toThrow(GoneException);
    });

    it('purges expired files from disk and marks status EXPIRED during cleanup job', async () => {
      // Create a dummy file on disk that should be purged
      const expiredFilePath = path.join(tempStorageDir, 'expired-file.zip');
      await fs.promises.writeFile(expiredFilePath, 'dummy zip content');
      expect(fs.existsSync(expiredFilePath)).toBe(true);

      mockPrisma.dataExport.findMany.mockResolvedValue([
        {
          id: 'expired-export-1',
          userId: 'user-1',
          status: DataExportStatus.COMPLETED,
          filePath: expiredFilePath,
          expiresAt: new Date(Date.now() - 1000), // expired in past
        },
      ]);
      mockPrisma.dataExport.update.mockResolvedValue({});

      const purgedCount = await service.cleanupExpiredExports();

      expect(purgedCount).toBe(1);
      // Verify file was deleted from disk
      expect(fs.existsSync(expiredFilePath)).toBe(false);

      // Verify DB was updated to EXPIRED status with cleared filePath
      expect(mockPrisma.dataExport.update).toHaveBeenCalledWith({
        where: { id: 'expired-export-1' },
        data: {
          status: DataExportStatus.EXPIRED,
          filePath: null,
        },
      });
    });
  });

  describe('processDataExport', () => {
    it('creates zip in private storage and updates export record with 7-day retention', async () => {
      mockPrisma.dataExport.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'USER',
        status: 'ACTIVE',
        trustScore: 50,
        stellarPublicKey: null,
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      mockPrisma.adoption.findMany.mockResolvedValue([]);
      mockPrisma.custody.findMany.mockResolvedValue([]);
      mockPrisma.document.findMany.mockResolvedValue([]);
      mockPrisma.eventLog.findMany.mockResolvedValue([]);

      await service.processDataExport('export-1', 'user-1');

      // Verify status transitions: first PROCESSING, then COMPLETED
      expect(mockPrisma.dataExport.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'export-1' },
        data: { status: DataExportStatus.PROCESSING },
      });

      expect(mockPrisma.dataExport.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'export-1' },
        data: expect.objectContaining({
          status: DataExportStatus.COMPLETED,
          filePath: expect.stringContaining('export_user-1_export-1.zip'),
          fileSize: expect.any(Number),
          expiresAt: expect.any(Date),
        }),
      });

      // Check the created file on disk
      const calls = mockPrisma.dataExport.update.mock.calls;
      const completedCall = calls[1][0];
      const createdPath = completedCall.data.filePath;
      expect(fs.existsSync(createdPath)).toBe(true);
    });
  });
});
