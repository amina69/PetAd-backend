import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import { NotificationDispatcher } from './notification.dispatcher';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { REALTIME_PUBLISHER } from '../realtime/realtime.publisher';

const mockPrisma = {
  notification: { create: jest.fn() },
  user: { findUnique: jest.fn() },
};

const mockPreferences = { resolve: jest.fn() };
const mockQueue = { enqueueSendTransactionalEmail: jest.fn() };
const mockPublisher = { publishToUser: jest.fn() };

describe('NotificationDispatcher', () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatcher,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationPreferencesService, useValue: mockPreferences },
        { provide: NotificationQueueService, useValue: mockQueue },
        { provide: REALTIME_PUBLISHER, useValue: mockPublisher },
      ],
    }).compile();

    dispatcher = module.get(NotificationDispatcher);
  });

  it('creates neither the in-app row nor the email when the type is disabled', async () => {
    mockPreferences.resolve.mockResolvedValue({
      type: NotificationType.MARKETING,
      inApp: false,
      email: false,
      push: false,
      canDisable: true,
    });

    const result = await dispatcher.dispatch({
      userId: 'u1',
      type: NotificationType.MARKETING,
      title: 'Promo',
      body: 'Deals',
      sendEmail: true,
    });

    expect(result).toBeNull();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    expect(mockQueue.enqueueSendTransactionalEmail).not.toHaveBeenCalled();
    expect(mockPublisher.publishToUser).not.toHaveBeenCalled();
  });

  it('creates the in-app row, publishes it and queues an email when allowed', async () => {
    const createdAt = new Date('2026-11-24T00:00:00.000Z');
    mockPreferences.resolve.mockResolvedValue({
      type: NotificationType.ADOPTION_UPDATE,
      inApp: true,
      email: true,
      push: false,
      canDisable: true,
    });
    mockPrisma.notification.create.mockResolvedValue({
      id: 'n1',
      userId: 'u1',
      type: NotificationType.ADOPTION_UPDATE,
      title: 'Adoption approved',
      body: 'Good news',
      data: null,
      readAt: null,
      createdAt,
    });
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'ada@example.com' });

    const result = await dispatcher.dispatch({
      userId: 'u1',
      type: NotificationType.ADOPTION_UPDATE,
      title: 'Adoption approved',
      body: 'Good news',
      sendEmail: true,
    });

    expect(result?.id).toBe('n1');
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mockPublisher.publishToUser).toHaveBeenCalledWith(
      'u1',
      'notification.created',
      expect.objectContaining({ id: 'n1', isRead: false }),
    );
    expect(mockQueue.enqueueSendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        dto: {
          to: 'ada@example.com',
          subject: 'Adoption approved',
          text: 'Good news',
        },
      }),
    );
  });

  it('skips email when the preference allows only in-app delivery', async () => {
    mockPreferences.resolve.mockResolvedValue({
      type: NotificationType.SYSTEM,
      inApp: true,
      email: false,
      push: false,
      canDisable: true,
    });
    mockPrisma.notification.create.mockResolvedValue({
      id: 'n2',
      userId: 'u1',
      type: NotificationType.SYSTEM,
      title: 'Maintenance',
      body: 'Tonight',
      data: null,
      readAt: null,
      createdAt: new Date(),
    });

    await dispatcher.dispatch({
      userId: 'u1',
      type: NotificationType.SYSTEM,
      title: 'Maintenance',
      body: 'Tonight',
      sendEmail: true,
    });

    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mockQueue.enqueueSendTransactionalEmail).not.toHaveBeenCalled();
  });
});
