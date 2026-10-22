import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    custody: { findMany: jest.fn() },
    escrow: { findMany: jest.fn() },
    document: { findMany: jest.fn(), deleteMany: jest.fn() },
    appLog: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockEvents = { logEvent: jest.fn() };
  const mockCloudinary = {
    uploadAvatar: jest.fn(),
    destroyAsset: jest.fn(),
  };

  const PASSWORD = 'StrongPass123';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.custody.findMany.mockResolvedValue([]);
    mockPrisma.escrow.findMany.mockResolvedValue([]);
    mockPrisma.document.findMany.mockResolvedValue([]);
    mockPrisma.document.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.appLog.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
        callback(mockPrisma),
    );
    mockCloudinary.destroyAsset.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('updateProfile', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'ACTIVE',
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });
    });

    it.each(['email', 'role', 'trustScore'])(
      'rejects %s in the request body',
      async (field) => {
        const dto = { [field]: 'x' } as never;

        const error = await service
          .updateProfile('user-1', dto)
          .catch((err: unknown) => err);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          message: [`property ${field} should not exist`],
        });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('updates only the whitelisted profile fields', async () => {
      const dto = {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+2348012345678',
        bio: 'Pet lover',
        location: 'Lagos',
      };

      await service.updateProfile('user-1', dto);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: dto }),
      );
    });

    it('throws 404 for an unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('missing', { firstName: 'Ada' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 for a soft-deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'DELETED',
      });

      await expect(
        service.updateProfile('user-1', { firstName: 'Ada' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateAvatar', () => {
    it('stores the Cloudinary url together with its public id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'ACTIVE',
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });

      await service.updateAvatar('user-1', {
        url: 'https://cdn.test/avatar.jpg',
        publicId: 'users/avatar',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            avatarUrl: 'https://cdn.test/avatar.jpg',
            avatarPublicId: 'users/avatar',
          },
        }),
      );
    });
  });

  describe('deleteProfile', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'ada@example.com',
        password: passwordHash,
        status: 'ACTIVE',
        avatarPublicId: 'users/avatar-1',
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });
      mockEvents.logEvent.mockResolvedValue({ id: 'event-1' });
    });

    it('requires password confirmation when deleting your own account', async () => {
      await expect(
        service.deleteProfile(
          'user-1',
          {},
          { actorId: 'user-1', isSelf: true },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      await expect(
        service.deleteProfile(
          'user-1',
          { password: 'WrongPassword1' },
          { actorId: 'user-1', isSelf: true },
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('anonymises the account, its assets and its logs', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { id: 'doc-1', publicId: 'adoptions/1/contract' },
      ]);
      mockPrisma.document.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.appLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          message: 'login for ada@example.com',
          metadata: { email: 'ada@example.com' },
        },
      ]);
      mockPrisma.appLog.update.mockResolvedValue({ id: 'log-1' });

      const result = await service.deleteProfile(
        'user-1',
        { password: PASSWORD },
        { actorId: 'user-1', isSelf: true },
      );

      expect(result).toMatchObject({
        userId: 'user-1',
        status: 'DELETED',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            status: 'DELETED',
            email: 'deleted+user-1@invalid',
            password: null,
            firstName: null,
            lastName: null,
            phone: null,
            bio: null,
            location: null,
            avatarUrl: null,
            avatarPublicId: null,
            stellarPublicKey: null,
            deletedAt: expect.any(Date) as unknown,
          }) as unknown,
        }),
      );

      expect(mockCloudinary.destroyAsset).toHaveBeenCalledWith(
        'users/avatar-1',
        'image',
      );
      expect(mockCloudinary.destroyAsset).toHaveBeenCalledWith(
        'adoptions/1/contract',
        'raw',
      );
      expect(mockPrisma.document.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['doc-1'] } },
      });

      expect(mockPrisma.appLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: {
          userId: null,
          message: 'login for deleted+user-1@invalid',
          metadata: { email: 'deleted+user-1@invalid' },
        },
      });

      expect(mockEvents.logEvent).toHaveBeenCalledWith({
        entityType: 'USER',
        entityId: 'user-1',
        eventType: 'USER_DELETED',
        actorId: 'user-1',
        payload: { userId: 'user-1' },
      });
    });

    it('allows an admin to delete another account without a password', async () => {
      await service.deleteProfile(
        'user-1',
        {},
        { actorId: 'admin-1', isSelf: false },
      );

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockEvents.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });

    it('blocks deletion while an active custody exists', async () => {
      mockPrisma.custody.findMany.mockResolvedValue([{ id: 'custody-1' }]);

      const error = await service
        .deleteProfile(
          'user-1',
          { password: PASSWORD },
          {
            actorId: 'user-1',
            isSelf: true,
          },
        )
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as {
        code: string;
        reasons: { code: string; references: string[] }[];
      };
      expect(response.code).toBe('ACCOUNT_DELETION_BLOCKED');
      expect(response.reasons).toEqual([
        expect.objectContaining({
          code: 'ACTIVE_CUSTODY',
          references: ['custody-1'],
        }),
      ]);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks deletion while a funded escrow exists', async () => {
      mockPrisma.escrow.findMany.mockResolvedValue([
        { id: 'escrow-1', status: 'FUNDED' },
      ]);

      const error = await service
        .deleteProfile(
          'user-1',
          { password: PASSWORD },
          {
            actorId: 'user-1',
            isSelf: true,
          },
        )
        .catch((err: unknown) => err);

      const response = (error as ConflictException).getResponse() as {
        code: string;
        reasons: { code: string }[];
      };
      expect(response.code).toBe('ACCOUNT_DELETION_BLOCKED');
      expect(response.reasons).toEqual([
        expect.objectContaining({ code: 'FUNDED_ESCROW' }),
      ]);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks deletion while a dispute is open', async () => {
      mockPrisma.escrow.findMany.mockResolvedValue([
        { id: 'escrow-2', status: 'DISPUTED' },
      ]);

      const error = await service
        .deleteProfile(
          'user-1',
          { password: PASSWORD },
          {
            actorId: 'user-1',
            isSelf: true,
          },
        )
        .catch((err: unknown) => err);

      const response = (error as ConflictException).getResponse() as {
        reasons: { code: string }[];
      };
      expect(response.reasons).toEqual([
        expect.objectContaining({ code: 'OPEN_DISPUTE' }),
      ]);
    });

    it('rejects deleting an already deleted account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'deleted+user-1@invalid',
        password: null,
        status: 'DELETED',
        avatarPublicId: null,
      });

      const error = await service
        .deleteProfile(
          'user-1',
          { password: PASSWORD },
          {
            actorId: 'user-1',
            isSelf: true,
          },
        )
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ACCOUNT_ALREADY_DELETED',
      });
    });

    it('throws 404 for an unknown account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteProfile(
          'missing',
          { password: PASSWORD },
          {
            actorId: 'missing',
            isSelf: true,
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
