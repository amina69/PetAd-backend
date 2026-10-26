import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DataExportService } from './data-export/data-export.service';
import { DataExportStatus } from '@prisma/client';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

function authRequest(
  overrides: Partial<{ sub: string; userId: string; role: string }> = {},
) {
  return {
    user: { sub: 'user-1', role: 'USER', ...overrides },
  } as never;
}

function uploadFile(buffer: Buffer, originalname = 'avatar.png') {
  return {
    buffer,
    originalname,
    mimetype: 'image/png',
    size: buffer.length,
  } as Express.Multer.File;
}

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    getPublicProfile: jest.fn(),
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updateAvatar: jest.fn(),
    deleteProfile: jest.fn(),
  };

  const mockCloudinary = {
    uploadAvatar: jest.fn(),
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
        { provide: CloudinaryService, useValue: mockCloudinary },
        { provide: DataExportService, useValue: mockDataExportService },
      ],
    }).compile();

    controller = module.get(UsersController);
  });

  describe('ownership', () => {
    it('accepts the JWT payload shape produced by JwtStrategy (sub)', async () => {
      mockUsersService.updateProfile.mockResolvedValue({ id: 'user-1' });

      await controller.updateProfile(
        'user-1',
        { firstName: 'Ada' },
        authRequest(),
      );

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('user-1', {
        firstName: 'Ada',
      });
    });

    it('rejects a user updating someone else', async () => {
      await expect(
        controller.updateProfile('user-2', { firstName: 'Ada' }, authRequest()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('allows an admin to update another profile', async () => {
      mockUsersService.updateProfile.mockResolvedValue({ id: 'user-2' });

      await controller.updateProfile(
        'user-2',
        { firstName: 'Ada' },
        authRequest({ sub: 'admin-1', role: 'ADMIN' }),
      );

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('user-2', {
        firstName: 'Ada',
      });
    });
  });

  describe('uploadAvatar', () => {
    it('rejects an SVG upload with 415', async () => {
      await expect(
        controller.uploadAvatar(
          'user-1',
          uploadFile(SVG_BYTES, 'avatar.svg'),
          authRequest(),
        ),
      ).rejects.toThrow(UnsupportedMediaTypeException);

      expect(mockCloudinary.uploadAvatar).not.toHaveBeenCalled();
    });

    it('rejects an executable renamed to .png with 415', async () => {
      await expect(
        controller.uploadAvatar(
          'user-1',
          uploadFile(EXE_BYTES, 'avatar.png'),
          authRequest(),
        ),
      ).rejects.toThrow(UnsupportedMediaTypeException);

      expect(mockCloudinary.uploadAvatar).not.toHaveBeenCalled();
    });

    it('requires a file', async () => {
      await expect(
        controller.uploadAvatar(
          'user-1',
          undefined as unknown as Express.Multer.File,
          authRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('uploads a real image and stores its public id', async () => {
      mockCloudinary.uploadAvatar.mockResolvedValue({
        secure_url: 'https://cdn.test/avatar.png',
        public_id: 'users/avatar',
      });
      mockUsersService.updateAvatar.mockResolvedValue({ id: 'user-1' });

      await controller.uploadAvatar(
        'user-1',
        uploadFile(PNG_BYTES),
        authRequest(),
      );

      expect(mockCloudinary.uploadAvatar).toHaveBeenCalledWith(
        PNG_BYTES,
        'users',
      );
      expect(mockUsersService.updateAvatar).toHaveBeenCalledWith('user-1', {
        url: 'https://cdn.test/avatar.png',
        publicId: 'users/avatar',
      });
    });
  });

  describe('deleteProfile', () => {
    it('passes password confirmation and self flag for self deletion', async () => {
      mockUsersService.deleteProfile.mockResolvedValue({ status: 'DELETED' });

      await controller.deleteProfile(
        'user-1',
        { password: 'StrongPass123' },
        authRequest(),
      );

      expect(mockUsersService.deleteProfile).toHaveBeenCalledWith(
        'user-1',
        { password: 'StrongPass123' },
        { actorId: 'user-1', isSelf: true },
      );
    });

    it('marks admin deletions of other accounts as non-self', async () => {
      mockUsersService.deleteProfile.mockResolvedValue({ status: 'DELETED' });

      await controller.deleteProfile(
        'user-2',
        {},
        authRequest({ sub: 'admin-1', role: 'ADMIN' }),
      );

      expect(mockUsersService.deleteProfile).toHaveBeenCalledWith(
        'user-2',
        {},
        { actorId: 'admin-1', isSelf: false },
      );
    });
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
