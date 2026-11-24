import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  notificationPreference: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
    mockPrisma.notificationPreference.upsert.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(NotificationPreferencesService);
  });

  it('defaults every normal type on and marketing-like types off', async () => {
    const adoption = await service.resolve(
      'u1',
      NotificationType.ADOPTION_UPDATE,
    );
    const marketing = await service.resolve('u1', NotificationType.MARKETING);

    expect(adoption).toEqual({
      type: NotificationType.ADOPTION_UPDATE,
      inApp: true,
      email: true,
      push: true,
      canDisable: true,
    });
    expect(marketing).toMatchObject({
      inApp: false,
      email: false,
      push: false,
    });
  });

  it('always keeps security types enabled and non-disableable', async () => {
    // Even a stored explicit "off" row must not disable a security type.
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'u1',
      type: NotificationType.SECURITY_2FA,
      inApp: false,
      email: false,
      push: false,
    });

    const preference = await service.resolve(
      'u1',
      NotificationType.SECURITY_2FA,
    );

    expect(preference).toMatchObject({
      inApp: true,
      email: true,
      push: true,
      canDisable: false,
    });
  });

  it('returns 422 and writes nothing when a security type is disabled', async () => {
    const error = await service
      .update('u1', [
        {
          type: NotificationType.ADOPTION_UPDATE,
          inApp: false,
        },
        {
          type: NotificationType.SECURITY_PASSWORD_CHANGED,
          email: false,
        },
      ])
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getStatus()).toBe(422);
    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('upserts only the supplied channels for non-security types', async () => {
    await service.update('u1', [
      { type: NotificationType.MARKETING, email: true, inApp: true },
    ]);

    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_type: {
            userId: 'u1',
            type: NotificationType.MARKETING,
          },
        },
        create: expect.objectContaining({
          userId: 'u1',
          type: NotificationType.MARKETING,
          inApp: true,
          email: true,
          push: false,
        }) as unknown,
        update: { inApp: true, email: true },
      }),
    );
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
