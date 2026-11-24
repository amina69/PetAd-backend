import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
};

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    userId: 'u1',
    type: NotificationType.SYSTEM,
    title: 'Title',
    body: 'Body',
    data: null,
    readAt: null,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('findAll', () => {
    it('scopes the query to the caller and returns isRead derived from readAt', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([
        notification({ readAt: new Date('2026-11-02T00:00:00.000Z') }),
      ]);

      const page = await service.findAll('u1');

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
      expect(page.data[0]).toMatchObject({
        id: 'n1',
        isRead: true,
      });
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('applies unread and type filters', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);

      await service.findAll('u1', {
        unread: true,
        type: NotificationType.DISPUTE_UPDATE,
      });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'u1',
            readAt: null,
            type: NotificationType.DISPUTE_UPDATE,
          },
        }),
      );
    });

    it('returns a next cursor and does not leak the extra row', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([
        notification({ id: 'n3', createdAt: new Date('2026-11-03T00:00:00Z') }),
        notification({ id: 'n2', createdAt: new Date('2026-11-02T00:00:00Z') }),
        notification({ id: 'n1', createdAt: new Date('2026-11-01T00:00:00Z') }),
      ]);

      const page = await service.findAll('u1', { limit: 2 });

      expect(page.data.map((item) => item.id)).toEqual(['n3', 'n2']);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBeTruthy();

      // The cursor encodes (createdAt, id) of the last returned row.
      const decoded = Buffer.from(
        page.nextCursor as string,
        'base64url',
      ).toString('utf8');
      expect(decoded).toBe('2026-11-02T00:00:00.000Z|n2');
    });

    it('turns the cursor into a stable (createdAt, id) keyset predicate', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      const cursor = Buffer.from(
        '2026-11-02T00:00:00.000Z|n2',
        'utf8',
      ).toString('base64url');

      await service.findAll('u1', { cursor });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'u1',
            AND: [
              {
                OR: [
                  { createdAt: { lt: new Date('2026-11-02T00:00:00.000Z') } },
                  {
                    createdAt: new Date('2026-11-02T00:00:00.000Z'),
                    id: { lt: 'n2' },
                  },
                ],
              },
            ],
          },
        }),
      );
    });

    it('rejects a malformed cursor', async () => {
      await expect(
        service.findAll('u1', { cursor: 'not-a-cursor' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('counts unread rows for the caller only', async () => {
      mockPrisma.notification.count.mockResolvedValue(4);

      await expect(service.unreadCount('u1')).resolves.toEqual({ count: 4 });
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'u1', readAt: null },
      });
    });
  });

  describe('markRead', () => {
    it("returns 404 for another user's notification", async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('u1', 'n-other')).rejects.toThrow(
        NotFoundException,
      );

      // Ownership is enforced inside the write query, not after reading.
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n-other', userId: 'u1', readAt: null },
        data: { readAt: expect.any(Date) as unknown },
      });
    });

    it('is idempotent when the notification is already read', async () => {
      const readAt = new Date('2026-11-02T00:00:00.000Z');
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.notification.findFirst.mockResolvedValue(
        notification({ readAt }),
      );

      const result = await service.markRead('u1', 'n1');

      expect(result.isRead).toBe(true);
      expect(result.readAt).toEqual(readAt);
    });

    it('marks an unread notification read', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.notification.findFirst.mockResolvedValue(
        notification({ readAt: new Date('2026-11-03T00:00:00.000Z') }),
      );

      const result = await service.markRead('u1', 'n1');

      expect(result.isRead).toBe(true);
    });
  });

  describe('markAllRead', () => {
    it('marks every unread notification in a single bulk update', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 7 });

      await expect(service.markAllRead('u1')).resolves.toEqual({ updated: 7 });

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', readAt: null },
        data: { readAt: expect.any(Date) as unknown },
      });
    });
  });
});
