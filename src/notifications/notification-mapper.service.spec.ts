import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { NotificationMapperService } from './notification-mapper.service';
import { NotificationTemplateService } from './templates/notification-template.service';
import { PushService } from './push/push.service';
import { NOTIFICATION_RULES } from './notification-rules';

describe('NotificationMapperService', () => {
  const adoption = {
    id: 'adoption-1',
    adopter: {
      id: 'adopter-1',
      email: 'adopter@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    owner: {
      id: 'owner-1',
      email: 'owner@example.com',
      firstName: 'Oscar',
      lastName: 'Owner',
    },
    pet: { id: 'pet-1', name: 'Rex' },
  };

  let mapper: NotificationMapperService;
  let dedupeKeys: Set<string>;
  let notificationId: number;
  const createdAt: Array<Record<string, any>> = [];

  const prismaMock = {
    adoption: { findUnique: jest.fn().mockResolvedValue(adoption) },
    custody: { findUnique: jest.fn().mockResolvedValue(null) },
    escrow: { findUnique: jest.fn().mockResolvedValue(null) },
    pet: { findUnique: jest.fn().mockResolvedValue(null) },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notification: {
      create: jest.fn(({ data }: { data: Record<string, any> }) => {
        if (dedupeKeys.has(data.dedupeKey)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('Unique constraint', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          );
        }
        dedupeKeys.add(data.dedupeKey);
        notificationId += 1;
        createdAt.push(data);
        return Promise.resolve({ id: `notification-${notificationId}` });
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const queueMock = {
    enqueueSendTransactionalEmail: jest.fn().mockResolvedValue({}),
  };
  const pushMock = {
    sendToUser: jest
      .fn()
      .mockResolvedValue({ sent: 0, pruned: 0, skipped: true }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    dedupeKeys = new Set();
    notificationId = 0;
    createdAt.length = 0;
    prismaMock.adoption.findUnique.mockResolvedValue(adoption);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationMapperService,
        NotificationTemplateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationQueueService, useValue: queueMock },
        { provide: PushService, useValue: pushMock },
      ],
    }).compile();

    mapper = moduleRef.get(NotificationMapperService);
  });

  const adoptionRequested = {
    id: 'event-1',
    entityType: 'ADOPTION',
    entityId: 'adoption-1',
    eventType: 'ADOPTION_REQUESTED',
    actorId: 'adopter-1',
    payload: {},
  };

  it('creates notifications for every rule on first delivery', async () => {
    const created = await mapper.handleEvent(adoptionRequested);

    // OWNER: EMAIL + IN_APP, ADOPTER: IN_APP
    expect(created).toBe(3);
    expect(queueMock.enqueueSendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('replaying the same event creates no duplicate notifications', async () => {
    const first = await mapper.handleEvent(adoptionRequested);
    const second = await mapper.handleEvent(adoptionRequested);

    expect(first).toBe(3);
    expect(second).toBe(0);
    expect(dedupeKeys.size).toBe(3);
    // No second email job was enqueued for the replay.
    expect(queueMock.enqueueSendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('supports new event rules as data only, with no service changes', async () => {
    NOTIFICATION_RULES.PET_BIRTHDAY = [
      {
        audience: 'OWNER',
        template: 'pet-adopted',
        channels: ['IN_APP'],
        priority: 'HIGH',
      },
    ];

    try {
      const created = await mapper.handleEvent({
        id: 'event-birthday',
        entityType: 'ADOPTION',
        entityId: 'adoption-1',
        eventType: 'PET_BIRTHDAY',
        payload: {},
      });

      expect(created).toBe(1);
      expect(createdAt[0].template).toBe('pet-adopted');
      expect(createdAt[0].priority).toBe('HIGH');
    } finally {
      delete NOTIFICATION_RULES.PET_BIRTHDAY;
    }
  });

  it('ignores event types without a rule', async () => {
    const created = await mapper.handleEvent({
      id: 'event-unknown',
      entityType: 'PET',
      entityId: 'pet-1',
      eventType: 'SOMETHING_UNMAPPED',
      payload: {},
    });

    expect(created).toBe(0);
  });
});
