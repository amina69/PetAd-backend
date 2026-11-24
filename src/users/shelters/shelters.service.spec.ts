import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SheltersService } from './shelters.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { NotificationQueueService } from '../../jobs/services/notification-queue.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  shelterProfile: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockEventsService = { logEvent: jest.fn() };
const mockNotificationQueue = { enqueueSendTransactionalEmail: jest.fn() };

const APPLICATION = {
  orgName: 'Lagos Happy Paws Shelter',
  registrationNumber: 'RC-1234567',
  address: '12 Marina Road, Lagos',
  phone: '+2348012345678',
};

describe('SheltersService', () => {
  let service: SheltersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.shelterProfile.findFirst.mockResolvedValue(null);
    mockEventsService.logEvent.mockResolvedValue({ id: 'event-1' });
    mockNotificationQueue.enqueueSendTransactionalEmail.mockResolvedValue({
      id: 'job-1',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SheltersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEventsService },
        {
          provide: NotificationQueueService,
          useValue: mockNotificationQueue,
        },
      ],
    }).compile();

    service = module.get<SheltersService>(SheltersService);
  });

  describe('apply', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'USER',
        status: 'ACTIVE',
        shelterProfile: null,
      });
      mockPrisma.shelterProfile.create.mockResolvedValue({
        id: 'shelter-1',
        userId: 'user-1',
        ...APPLICATION,
        verificationStatus: 'PENDING',
        verifiedAt: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        role: 'SHELTER',
      });
    });

    it('creates a PENDING profile and grants the SHELTER role', async () => {
      const profile = await service.apply('user-1', APPLICATION);

      expect(profile.verificationStatus).toBe('PENDING');
      expect(mockPrisma.shelterProfile.create).toHaveBeenCalledWith({
        data: { ...APPLICATION, userId: 'user-1' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'SHELTER' },
      });
    });

    it('re-submits a rejected application back to PENDING', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'SHELTER',
        status: 'ACTIVE',
        shelterProfile: {
          id: 'shelter-1',
          registrationNumber: 'OLD-1',
          verificationStatus: 'REJECTED',
        },
      });
      mockPrisma.shelterProfile.update.mockResolvedValue({
        id: 'shelter-1',
        verificationStatus: 'PENDING',
      });

      await service.apply('user-1', APPLICATION);

      expect(mockPrisma.shelterProfile.update).toHaveBeenCalledWith({
        where: { id: 'shelter-1' },
        data: {
          ...APPLICATION,
          verificationStatus: 'PENDING',
          verifiedAt: null,
          rejectionReason: null,
        },
      });
      // Already SHELTER, so the role is left untouched.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a second application from a verified shelter', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'SHELTER',
        status: 'ACTIVE',
        shelterProfile: {
          id: 'shelter-1',
          registrationNumber: 'RC-1234567',
          verificationStatus: 'VERIFIED',
        },
      });

      await expect(service.apply('user-1', APPLICATION)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.shelterProfile.create).not.toHaveBeenCalled();
      expect(mockPrisma.shelterProfile.update).not.toHaveBeenCalled();
    });

    it('refuses a registration number already claimed by another shelter', async () => {
      mockPrisma.shelterProfile.findFirst.mockResolvedValue({ id: 'other' });

      await expect(service.apply('user-1', APPLICATION)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.shelterProfile.create).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown or deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.apply('missing', APPLICATION)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verify', () => {
    beforeEach(() => {
      const verifiedAt = new Date('2026-11-24T10:00:00.000Z');
      mockPrisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'shelter-1',
        userId: 'user-1',
        orgName: APPLICATION.orgName,
        verificationStatus: 'PENDING',
        user: { id: 'user-1', email: 'shelter@example.com' },
        verifiedAt,
      });
      mockPrisma.shelterProfile.update.mockResolvedValue({
        id: 'shelter-1',
        verificationStatus: 'VERIFIED',
        verifiedAt,
      });
    });

    it('marks the shelter VERIFIED, logs SHELTER_VERIFIED and notifies it', async () => {
      const result = await service.verify('shelter-1', 'admin-1');

      expect(result.verificationStatus).toBe('VERIFIED');
      expect(mockPrisma.shelterProfile.update).toHaveBeenCalledWith({
        where: { id: 'shelter-1' },
        data: {
          verificationStatus: 'VERIFIED',
          verifiedAt: expect.any(Date) as unknown as Date,
          rejectionReason: null,
        },
      });

      expect(mockEventsService.logEvent).toHaveBeenCalledWith({
        entityType: 'SHELTER',
        entityId: 'shelter-1',
        eventType: 'SHELTER_VERIFIED',
        actorId: 'admin-1',
        payload: {
          shelterId: 'shelter-1',
          userId: 'user-1',
          orgName: APPLICATION.orgName,
          verifiedAt: expect.any(String) as unknown as string,
          verifiedBy: 'admin-1',
        },
      });

      expect(
        mockNotificationQueue.enqueueSendTransactionalEmail,
      ).toHaveBeenCalledWith({
        dto: expect.objectContaining({
          to: 'shelter@example.com',
          subject: expect.stringContaining('verified') as unknown as string,
        }) as unknown,
      });
    });

    it('keeps the verification when the notification enqueue fails', async () => {
      mockNotificationQueue.enqueueSendTransactionalEmail.mockRejectedValue(
        new Error('redis down'),
      );

      await expect(
        service.verify('shelter-1', 'admin-1'),
      ).resolves.toMatchObject({ verificationStatus: 'VERIFIED' });
      expect(mockEventsService.logEvent).toHaveBeenCalled();
    });

    it('is idempotent-safe: an already verified shelter conflicts', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'shelter-1',
        userId: 'user-1',
        orgName: APPLICATION.orgName,
        verificationStatus: 'VERIFIED',
        user: { id: 'user-1', email: 'shelter@example.com' },
      });

      await expect(service.verify('shelter-1')).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.shelterProfile.update).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown application', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(null);

      await expect(service.verify('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('stores the reason, clears verifiedAt and logs SHELTER_REJECTED', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'shelter-1',
        userId: 'user-1',
        orgName: APPLICATION.orgName,
        verificationStatus: 'PENDING',
        user: { id: 'user-1', email: 'shelter@example.com' },
      });
      mockPrisma.shelterProfile.update.mockResolvedValue({
        id: 'shelter-1',
        verificationStatus: 'REJECTED',
      });

      const result = await service.reject(
        'shelter-1',
        { reason: 'Invalid registration' },
        'admin-1',
      );

      expect(result.verificationStatus).toBe('REJECTED');
      expect(mockPrisma.shelterProfile.update).toHaveBeenCalledWith({
        where: { id: 'shelter-1' },
        data: {
          verificationStatus: 'REJECTED',
          verifiedAt: null,
          rejectionReason: 'Invalid registration',
        },
      });
      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'SHELTER',
          eventType: 'SHELTER_REJECTED',
          actorId: 'admin-1',
        }),
      );
    });
  });

  describe('assertCanPublish', () => {
    it('blocks a SHELTER account that is not verified yet', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        role: 'SHELTER',
        shelterProfile: { verificationStatus: 'PENDING' },
      });

      const error = await service
        .assertCanPublish('user-1')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'SHELTER_NOT_VERIFIED',
      });
    });

    it('blocks a SHELTER account without an application', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        role: 'SHELTER',
        shelterProfile: null,
      });

      await expect(service.assertCanPublish('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a verified shelter', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        role: 'SHELTER',
        shelterProfile: { verificationStatus: 'VERIFIED' },
      });

      await expect(service.assertCanPublish('user-1')).resolves.toBeUndefined();
    });

    it('does not restrict non-shelter roles', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        role: 'ADMIN',
        shelterProfile: null,
      });

      await expect(
        service.assertCanPublish('admin-1'),
      ).resolves.toBeUndefined();
    });
  });
});
