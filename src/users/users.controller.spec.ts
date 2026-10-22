import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

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
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updateAvatar: jest.fn(),
    deleteProfile: jest.fn(),
  };

  const mockCloudinary = {
    uploadAvatar: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: CloudinaryService, useValue: mockCloudinary },
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
});
