import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DataExportService } from './data-export/data-export.service';
import { DataExportStatus } from '@prisma/client';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    getPublicProfile: jest.fn(),
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updateAvatar: jest.fn(),
    deleteProfile: jest.fn(),
  };

  const mockCloudinaryService = {
    uploadImage: jest.fn(),
  };

  const mockDataExportService = {
    requestDataExport: jest.fn(),
    getDataExportStatus: jest.fn(),
    getExportFileForDownload: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: DataExportService, useValue: mockDataExportService },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('getPublicProfile', () => {
    it('returns public profile contract without requiring authentication', async () => {
      const publicData = {
        id: 'usr-1',
        displayName: 'John D.',
        avatarUrl: null,
        memberSince: '2026-01-01T00:00:00.000Z',
        verifiedBadges: [],
        completedAgreements: 0,
        ratingSummary: { average: 0, count: 0 },
      };
      mockUsersService.getPublicProfile.mockResolvedValue(publicData);

      const result = await controller.getPublicProfile('usr-1');

      expect(mockUsersService.getPublicProfile).toHaveBeenCalledWith('usr-1');
      expect(result).toEqual(publicData);
      expect(Object.keys(result).sort()).toEqual([
        'avatarUrl',
        'completedAgreements',
        'displayName',
        'id',
        'memberSince',
        'ratingSummary',
        'verifiedBadges',
      ]);
    });
  });

  describe('POST me/data-export', () => {
    it('enqueues export and returns 202 response', async () => {
      mockDataExportService.requestDataExport.mockResolvedValue({
        id: 'export-1',
        requestId: 'export-1',
        status: DataExportStatus.PENDING,
        message: 'Data export request enqueued successfully',
      });

      const req = {
        user: { userId: 'usr-1', role: 'USER' },
      } as unknown as Parameters<typeof controller.requestDataExport>[0];
      const response = await controller.requestDataExport(req);

      expect(mockDataExportService.requestDataExport).toHaveBeenCalledWith(
        'usr-1',
      );
      expect(response.id).toBe('export-1');
      expect(response.status).toBe(DataExportStatus.PENDING);
    });

    it('throws UnauthorizedException if user not authenticated', async () => {
      const req = {
        user: {},
      } as unknown as Parameters<typeof controller.requestDataExport>[0];
      await expect(controller.requestDataExport(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('GET me/data-export/:id', () => {
    it('returns export status and short-lived signed URL', async () => {
      mockDataExportService.getDataExportStatus.mockResolvedValue({
        id: 'export-1',
        status: DataExportStatus.COMPLETED,
        downloadUrl:
          '/users/me/data-export/export-1/download?expires=123&sig=abc',
        linkExpiresAt: '2026-10-22T13:30:00.000Z',
        expiresAt: '2026-10-29T13:00:00.000Z',
        createdAt: '2026-10-22T13:00:00.000Z',
      });

      const req = {
        user: { userId: 'usr-1', role: 'USER' },
      } as unknown as Parameters<typeof controller.getDataExportStatus>[1];
      const result = await controller.getDataExportStatus('export-1', req);

      expect(mockDataExportService.getDataExportStatus).toHaveBeenCalledWith(
        'export-1',
        'usr-1',
      );
      expect(result.status).toBe(DataExportStatus.COMPLETED);
      expect(result.downloadUrl).toBeDefined();
    });
  });

  describe('GET me/data-export/:id/download', () => {
    it('pipes stream with zip headers', async () => {
      const pipeSpy = jest.fn();
      const mockStream = {
        pipe: pipeSpy,
      };
      mockDataExportService.getExportFileForDownload.mockResolvedValue({
        stream: mockStream,
        fileSize: 1024,
        fileName: 'personal-data-export-export-1.zip',
      });

      const req = {
        user: { userId: 'usr-1' },
      } as unknown as Parameters<typeof controller.downloadDataExport>[3];
      const setSpy = jest.fn();
      const res = {
        set: setSpy,
      } as unknown as Parameters<typeof controller.downloadDataExport>[4];

      await controller.downloadDataExport(
        'export-1',
        '12345678',
        'valid-sig',
        req,
        res,
      );

      expect(setSpy).toHaveBeenCalledWith({
        'Content-Type': 'application/zip',
        'Content-Disposition':
          'attachment; filename="personal-data-export-export-1.zip"',
        'Content-Length': '1024',
      });
      expect(pipeSpy).toHaveBeenCalledWith(res);
    });
  });

  describe('Ownership checks', () => {
    it('blocks non-admin from accessing other user profile', async () => {
      const req = {
        user: { userId: 'usr-2', role: 'USER' },
      } as unknown as Parameters<typeof controller.getProfile>[1];
      await expect(controller.getProfile('usr-1', req)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('allows admin to access other user profile', async () => {
      const req = {
        user: { userId: 'admin-1', role: 'ADMIN' },
      } as unknown as Parameters<typeof controller.getProfile>[1];
      mockUsersService.getProfile.mockResolvedValue({ id: 'usr-1' });

      const profile = await controller.getProfile('usr-1', req);
      expect(profile.id).toBe('usr-1');
    });
  });
});
