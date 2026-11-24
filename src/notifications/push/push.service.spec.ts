import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import webpush from 'web-push';
import { PushService } from './push.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
}));

describe('PushService', () => {
  const subscription = {
    id: 'sub-1',
    userId: 'user-1',
    endpoint: 'https://push.example.com/abc',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
  };

  const prismaMock = {
    pushSubscription: {
      findMany: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn(),
    },
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === 'VAPID_PUBLIC_KEY') return 'public-key';
      if (key === 'VAPID_PRIVATE_KEY') return 'private-key';
      if (key === 'VAPID_SUBJECT') return 'mailto:test@petad.local';
      return undefined;
    }),
  };

  let service: PushService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.pushSubscription.findMany.mockResolvedValue([subscription]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: ConfigService, useValue: configMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(PushService);
    service.onModuleInit();
  });

  it('deletes expired subscriptions after a failed send', async () => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({
      statusCode: 410,
    });

    const result = await service.sendToUser('user-1', {
      title: 'Update',
      body: 'Something happened',
      route: '/pets/1',
    });

    expect(result).toEqual({ sent: 0, pruned: 1 });
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
    });
  });

  it('sends only title, short body and route', async () => {
    (webpush.sendNotification as jest.Mock).mockResolvedValue({});

    await service.sendToUser('user-1', {
      title: 'Adoption approved',
      body: 'Your request for Rex was approved.',
      route: '/adoptions/1',
      // Extra fields must be stripped by the whitelist, not forwarded.
      email: 'adopter@example.com',
      phone: '+15550001111',
    } as any);

    const sendNotificationMock = webpush.sendNotification as jest.Mock;
    const calls = sendNotificationMock.mock.calls as unknown as Array<
      [unknown, string]
    >;
    const payload = JSON.parse(calls[0][1]) as Record<string, string>;

    expect(Object.keys(payload).sort()).toEqual(['body', 'route', 'title']);
    expect(payload.body.length).toBeLessThanOrEqual(140);
    expect(JSON.stringify(payload)).not.toContain('@example.com');
  });
});
