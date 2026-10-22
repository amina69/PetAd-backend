import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ShelterVerificationStatus } from '@prisma/client';
import { SheltersService } from './shelters.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { NotificationQueueService } from '../../jobs/services/notification-queue.service';
import { ApplyShelterDto } from './dto/apply-shelter.dto';

describe('SheltersService', () => {
  let service: SheltersService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    shelterProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  const mockNotificationQueue = {
    enqueueSendTransactionalEmail: jest.fn(),
  };

  const applyDto: ApplyShelterDto = {
    orgName: 'Hope Paws Shelter',
    registrationNumber: 'REG-12345',
    address: '12 Charity Lane, Lagos',
    phone: '+2348012345678',
  };

  const shelterUser = {
    id: 'user-1',
    email: 'shelter@test.com',
    role: 'USER',
  };

  const pendingProfile = {
    id: 'profile-1',
    userId: 'user-1',
    orgName: applyDto.orgName,
    registrationNumber: applyDto.registrationNumber,
    address: applyDto.address,
    phone: applyDto.phone,
    verificationStatus: ShelterVerificationStatus.PENDING,
    verifiedAt: null,
    createdAt: new Date('2026-01-01'),
    user: { email: shelterUser.email },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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

    service = module.get(SheltersService);
  });

  describe('apply', () => {
    it('creates a pending profile and promotes the applicant to SHELTER', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(shelterUser);
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(null);
      mockPrisma.shelterProfile.create.mockResolvedValue(pendingProfile);
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.apply('user-1', applyDto);

      expect(result).toMatchObject({
        userId: 'user-1',
        orgName: applyDto.orgName,
        verificationStatus: ShelterVerificationStatus.PENDING,
        isVerified: false,
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'SHELTER' },
      });
    });

    it('throws 404 for an unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.apply('ghost', applyDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 409 when an application already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(shelterUser);
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(pendingProfile);

      await expect(service.apply('user-1', applyDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 403 for admin accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...shelterUser,
        role: 'ADMIN',
      });

      await expect(service.apply('user-1', applyDto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('verify', () => {
    it('approves the shelter, emits SHELTER_VERIFIED and notifies', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(pendingProfile);
      mockPrisma.shelterProfile.update.mockResolvedValue({
        ...pendingProfile,
        verificationStatus: ShelterVerificationStatus.APPROVED,
        verifiedAt: new Date(),
      });
      mockEventsService.logEvent.mockResolvedValue({});
      mockNotificationQueue.enqueueSendTransactionalEmail.mockResolvedValue({});

      const result = await service.verify('profile-1', 'admin-1');

      expect(result).toMatchObject({
        verificationStatus: ShelterVerificationStatus.APPROVED,
        isVerified: true,
      });
      expect(mockPrisma.shelterProfile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: {
          verificationStatus: ShelterVerificationStatus.APPROVED,
          verifiedAt: expect.any(Date) as Date,
        },
      });
      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'USER',
          entityId: 'user-1',
          eventType: 'SHELTER_VERIFIED',
          actorId: 'admin-1',
        }),
      );
      expect(
        mockNotificationQueue.enqueueSendTransactionalEmail,
      ).toHaveBeenCalledTimes(1);
    });

    it('still verifies when the notification queue is down', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(pendingProfile);
      mockPrisma.shelterProfile.update.mockResolvedValue({
        ...pendingProfile,
        verificationStatus: ShelterVerificationStatus.APPROVED,
        verifiedAt: new Date(),
      });
      mockEventsService.logEvent.mockResolvedValue({});
      mockNotificationQueue.enqueueSendTransactionalEmail.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(
        service.verify('profile-1', 'admin-1'),
      ).resolves.toMatchObject({ isVerified: true });
    });

    it('throws 422 when the shelter is already verified', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue({
        ...pendingProfile,
        verificationStatus: ShelterVerificationStatus.APPROVED,
      });

      await expect(service.verify('profile-1', 'admin-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('throws 404 for an unknown profile', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(null);

      await expect(service.verify('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('rejects the application and notifies with the reason', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(pendingProfile);
      mockPrisma.shelterProfile.update.mockResolvedValue({
        ...pendingProfile,
        verificationStatus: ShelterVerificationStatus.REJECTED,
      });
      mockNotificationQueue.enqueueSendTransactionalEmail.mockResolvedValue({});

      const result = await service.reject('profile-1', {
        reason: 'Registration number could not be confirmed',
      });

      expect(result).toMatchObject({
        verificationStatus: ShelterVerificationStatus.REJECTED,
        isVerified: false,
      });
      expect(mockPrisma.shelterProfile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: {
          verificationStatus: ShelterVerificationStatus.REJECTED,
          verifiedAt: null,
        },
      });
      const enqueueMock =
        mockNotificationQueue.enqueueSendTransactionalEmail as jest.Mock<
          Promise<unknown>,
          [{ dto: { text: string } }]
        >;
      const notification = enqueueMock.mock.calls[0][0];
      expect(notification.dto.text).toContain(
        'Registration number could not be confirmed',
      );
    });

    it('throws 422 for an already verified shelter', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue({
        ...pendingProfile,
        verificationStatus: ShelterVerificationStatus.APPROVED,
      });

      await expect(service.reject('profile-1', {})).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('getPublicProfile', () => {
    it('exposes the verified badge', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue({
        ...pendingProfile,
        verificationStatus: ShelterVerificationStatus.APPROVED,
        verifiedAt: new Date(),
      });

      const result = await service.getPublicProfile('profile-1');

      expect(result).toMatchObject({
        id: 'profile-1',
        orgName: applyDto.orgName,
        verificationStatus: ShelterVerificationStatus.APPROVED,
        isVerified: true,
      });
    });

    it('throws 404 for an unknown profile', async () => {
      mockPrisma.shelterProfile.findUnique.mockResolvedValue(null);

      await expect(service.getPublicProfile('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
