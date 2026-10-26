import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  adoption: {
    count: jest.fn(),
  },
  custody: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  escrow: { findMany: jest.fn() },
  document: { findMany: jest.fn(), deleteMany: jest.fn() },
  appLog: { findMany: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

const mockEventsService = {
  logEvent: jest.fn(),
};

const mockCloudinary = {
  uploadAvatar: jest.fn(),
  destroyAsset: jest.fn(),
};

const PASSWORD = 'StrongPass123';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

describe('UsersService', () => {
  let service: UsersService;

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
        { provide: EventsService, useValue: mockEventsService },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getPublicProfile', () => {
    const mockUser = {
      id: 'usr-1',
      firstName: 'Alice',
      lastName: 'Smith',
      avatarUrl: 'https://cdn.example.com/alice.jpg',
      role: 'USER',
      trustScore: 85,
      stellarPublicKey: 'GBBD675QEXAMPLEKEY',
      status: 'ACTIVE',
      deletedAt: null,
      createdAt: new Date('2025-06-01T10:00:00.000Z'),
    };

    it('returns public profile with exact contract key set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.adoption.count.mockResolvedValue(2);
      mockPrisma.custody.count.mockResolvedValue(1);

      const profile = await service.getPublicProfile('usr-1');

      // Acceptance Criteria: Contract test asserts the exact key set (no accidental additions)
      const expectedKeys = [
        'avatarUrl',
        'completedAgreements',
        'displayName',
        'id',
        'memberSince',
        'ratingSummary',
        'verifiedBadges',
      ].sort();

      expect(Object.keys(profile).sort()).toEqual(expectedKeys);

      // Verify no PII or sensitive keys leaked
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('address');
      expect(profile).not.toHaveProperty('stellarPublicKey');
      expect(profile).not.toHaveProperty('password');
      expect(profile).not.toHaveProperty('trustScore');
      expect(profile).not.toHaveProperty('role');
      expect(profile).not.toHaveProperty('status');
      expect(profile).not.toHaveProperty('deletedAt');

      expect(profile.id).toBe('usr-1');
      expect(profile.displayName).toBe('Alice S.');
      expect(profile.avatarUrl).toBe('https://cdn.example.com/alice.jpg');
      expect(profile.memberSince).toBe('2025-06-01T10:00:00.000Z');
      expect(profile.completedAgreements).toBe(3);
      expect(profile.verifiedBadges).toContain('STELLAR_VERIFIED');
      expect(profile.verifiedBadges).toContain('TOP_RATED');
      expect(profile.ratingSummary).toEqual({
        average: 4.3,
        count: 3,
      });
    });

    it('formats displayName as first name + last initial', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        firstName: '  John  ',
        lastName: '  Doe  ',
      });
      mockPrisma.adoption.count.mockResolvedValue(0);
      mockPrisma.custody.count.mockResolvedValue(0);

      const profile = await service.getPublicProfile('usr-1');
      expect(profile.displayName).toBe('John D.');
    });

    it('handles user with only firstName', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        firstName: 'Madonna',
        lastName: null,
      });
      mockPrisma.adoption.count.mockResolvedValue(0);
      mockPrisma.custody.count.mockResolvedValue(0);

      const profile = await service.getPublicProfile('usr-1');
      expect(profile.displayName).toBe('Madonna');
    });

    it('assigns VERIFIED_SHELTER badge to shelter users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        role: 'SHELTER',
        stellarPublicKey: null,
        trustScore: 60,
      });
      mockPrisma.adoption.count.mockResolvedValue(0);
      mockPrisma.custody.count.mockResolvedValue(0);

      const profile = await service.getPublicProfile('usr-1');
      expect(profile.verifiedBadges).toEqual(['VERIFIED_SHELTER']);
    });

    it('throws NotFoundException if user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getPublicProfile('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if user is SUSPENDED', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        status: 'SUSPENDED',
      });

      await expect(service.getPublicProfile('usr-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if user is DELETED', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        status: 'DELETED',
      });

      await expect(service.getPublicProfile('usr-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if user has deletedAt set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      });

      await expect(service.getPublicProfile('usr-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('standard profile operations', () => {
    it('gets profile successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        role: 'USER',
        avatarUrl: null,
        createdAt: new Date(),
      });

      const profile = await service.getProfile('usr-1');
      expect(profile.email).toBe('alice@example.com');
    });

    it('updates profile successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        status: UserStatus.ACTIVE,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'usr-1',
        firstName: 'Alicia',
      });

      const updated = await service.updateProfile('usr-1', {
        firstName: 'Alicia',
      });
      expect(updated.firstName).toBe('Alicia');
    });

    it('soft-deletes the profile without removing the row', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        email: 'alice@example.com',
        password: passwordHash,
        status: UserStatus.ACTIVE,
        avatarPublicId: null,
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'usr-1' });

      const res = await service.deleteProfile(
        'usr-1',
        {},
        { actorId: 'admin-1', isSelf: false },
      );

      expect(res.status).toBe(UserStatus.DELETED);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'usr-1' } }),
      );
    });
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
      mockEventsService.logEvent.mockResolvedValue({ id: 'event-1' });
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

      expect(mockEventsService.logEvent).toHaveBeenCalledWith({
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
      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
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

  describe('suspend', () => {
    it('marks an active user as SUSPENDED and records the reason', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date('2026-01-01T00:00:00.000Z'),
        suspensionReason: 'Trust policy violation',
      });

      const result = await service.suspend(
        'user-1',
        '  Trust policy violation  ',
        'admin-1',
      );

      expect(result.status).toBe(UserStatus.SUSPENDED);

      const [[updateCall]] = mockPrisma.user.update.mock.calls as unknown as [
        [
          {
            where: { id: string };
            data: {
              status: UserStatus;
              suspensionReason: string;
              suspendedAt: Date;
            };
          },
        ],
      ];

      expect(updateCall.where).toEqual({ id: 'user-1' });
      expect(updateCall.data.status).toBe(UserStatus.SUSPENDED);
      expect(updateCall.data.suspensionReason).toBe('Trust policy violation');
      expect(updateCall.data.suspendedAt).toBeInstanceOf(Date);
    });

    it('logs a USER_SUSPENDED event with the acting admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });

      await service.suspend('user-1', 'Abuse', 'admin-1');

      const [[eventCall]] = mockEventsService.logEvent.mock
        .calls as unknown as [
        [
          {
            entityType: string;
            entityId: string;
            eventType: string;
            actorId: string;
            payload: Record<string, unknown>;
          },
        ],
      ];

      expect(eventCall.entityType).toBe('USER');
      expect(eventCall.entityId).toBe('user-1');
      expect(eventCall.eventType).toBe('USER_SUSPENDED');
      expect(eventCall.actorId).toBe('admin-1');
      expect(eventCall.payload).toEqual({
        userId: 'user-1',
        reason: 'Abuse',
        suspendedAt: expect.any(String) as string,
        suspendedBy: 'admin-1',
      });
    });

    it('throws 404 for an unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.suspend('missing', 'reason')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws 409 when the user is already suspended', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.SUSPENDED,
      });

      await expect(service.suspend('user-1', 'again')).rejects.toThrow(
        ConflictException,
      );
      expect(mockEventsService.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('reinstate', () => {
    it('restores ACTIVE status and clears suspension metadata', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      });

      const result = await service.reinstate('user-1', 'admin-1');

      expect(result.status).toBe(UserStatus.ACTIVE);

      const [[updateCall]] = mockPrisma.user.update.mock.calls as unknown as [
        [
          {
            where: { id: string };
            data: {
              status: UserStatus;
              suspendedAt: null;
              suspensionReason: null;
            };
          },
        ],
      ];

      expect(updateCall.where).toEqual({ id: 'user-1' });
      expect(updateCall.data).toEqual({
        status: UserStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      });
    });

    it('logs a USER_REINSTATED event', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });

      await service.reinstate('user-1', 'admin-1');

      const [[eventCall]] = mockEventsService.logEvent.mock
        .calls as unknown as [
        [
          {
            entityType: string;
            entityId: string;
            eventType: string;
            actorId: string;
          },
        ],
      ];

      expect(eventCall.entityType).toBe('USER');
      expect(eventCall.entityId).toBe('user-1');
      expect(eventCall.eventType).toBe('USER_REINSTATED');
      expect(eventCall.actorId).toBe('admin-1');
    });

    it('throws 409 when the user is not suspended', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        suspendedAt: null,
      });

      await expect(service.reinstate('user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 404 for an unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.reinstate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
