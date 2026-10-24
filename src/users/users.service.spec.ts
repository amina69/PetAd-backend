import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    adoption: {
      count: jest.fn(),
    },
    custody: {
      count: jest.fn(),
    },
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockEventsService = {
  logEvent: jest.fn(),
};

describe('UsersService – suspension lifecycle', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEventsService },
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
      mockPrisma.user.update.mockResolvedValue({
        id: 'usr-1',
        firstName: 'Alicia',
      });

      const updated = await service.updateProfile('usr-1', {
        firstName: 'Alicia',
      });
      expect(updated.firstName).toBe('Alicia');
    });

    it('deletes profile successfully', async () => {
      mockPrisma.user.delete.mockResolvedValue({});
      const res = await service.deleteProfile('usr-1');
      expect(res.message).toBe('User deleted successfully');
    jest.clearAllMocks();
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
