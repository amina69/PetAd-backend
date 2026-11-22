import { NotFoundException } from '@nestjs/common';
import { BadgeService } from './badge.service';

const user = {
  id: 'user-1',
  role: 'SHELTER',
  trustScore: 90,
  stellarPublicKey: 'GPUBLIC',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
};

const definition = {
  id: 'def-shelter',
  code: 'VERIFIED_SHELTER',
  name: 'Verified shelter',
  description: 'Registered shelter account in good standing.',
  criteria: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const awardedBadge = {
  id: 'badge-1',
  userId: 'user-1',
  definitionId: 'def-shelter',
  status: 'AWARDED',
  supportingEventIds: ['event-1'],
  reason: 'Registered shelter account',
  awardedAt: new Date(),
  revokedAt: null,
  updatedAt: new Date(),
  definition,
};

function build() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    badgeDefinition: { findMany: jest.fn().mockResolvedValue([definition]) },
    userBadge: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue(awardedBadge),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const rules = {
    evaluate: jest.fn().mockResolvedValue({
      holds: true,
      supportingEventIds: ['event-1'],
      reason: 'Registered shelter account',
    }),
  };

  const events = { logEvent: jest.fn().mockResolvedValue(undefined) };

  const service = new BadgeService(
    prisma as never,
    rules as never,
    events as never,
  );

  return { service, prisma, rules, events };
}

describe('BadgeService', () => {
  it('awards a badge with its supporting event ids and emits an event', async () => {
    const { service, prisma, events } = build();
    prisma.userBadge.findUnique.mockResolvedValue(null);
    prisma.userBadge.findMany.mockResolvedValue([awardedBadge]);

    const badges = await service.evaluate('user-1');

    expect(prisma.userBadge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'AWARDED',
          supportingEventIds: ['event-1'],
        }),
      }),
    );
    expect(events.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'BADGE_AWARDED' }),
    );
    expect(badges).toEqual([
      expect.objectContaining({
        code: 'VERIFIED_SHELTER',
        supportingEventIds: ['event-1'],
      }),
    ]);
  });

  it('does not award a badge whose rule has no supporting events', async () => {
    const { service, prisma, rules, events } = build();
    rules.evaluate.mockResolvedValue({
      holds: false,
      supportingEventIds: [],
      reason: 'Account is not a shelter',
    });
    prisma.userBadge.findUnique.mockResolvedValue(null);
    prisma.userBadge.findMany.mockResolvedValue([]);

    const badges = await service.evaluate('user-1');

    expect(prisma.userBadge.upsert).not.toHaveBeenCalled();
    expect(events.logEvent).not.toHaveBeenCalled();
    expect(badges).toEqual([]);
  });

  it('revokes a badge automatically when its rule stops holding', async () => {
    const { service, prisma, rules, events } = build();
    rules.evaluate.mockResolvedValue({
      holds: false,
      supportingEventIds: [],
      reason: 'Account status is SUSPENDED',
    });
    prisma.userBadge.findUnique.mockResolvedValue(awardedBadge);
    prisma.userBadge.update.mockResolvedValue({
      ...awardedBadge,
      status: 'REVOKED',
      revokedAt: new Date(),
    });
    prisma.userBadge.findMany.mockResolvedValue([]);

    const badges = await service.evaluate('user-1');

    expect(prisma.userBadge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'badge-1' },
        data: expect.objectContaining({ status: 'REVOKED' }),
      }),
    );
    expect(events.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'BADGE_REVOKED' }),
    );
    expect(badges).toEqual([]);
  });

  it('404s for an unknown user', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.evaluate('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
