import { BadRequestException } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

const FROM = '2026-03-01T00:00:00.000Z';
const TO = '2026-03-10T00:00:00.000Z';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    actorId: 'user-1',
    eventType: 'ADOPTION_APPROVED',
    entityType: 'ADOPTION',
    entityId: 'adoption-1',
    payload: { adoptionId: 'adoption-1', password: 'canary' },
    metadata: { requestId: 'req-1' },
    createdAt: new Date('2026-03-05T10:00:00.000Z'),
    ...overrides,
  };
}

function appLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    userId: 'user-2',
    level: 'INFO',
    action: 'PAYMENT_PAID',
    message: 'Payment paid',
    metadata: {
      entityType: 'ESCROW',
      entityId: 'escrow-1',
      requestId: 'req-2',
      password: 'canary',
    },
    createdAt: new Date('2026-03-05T11:00:00.000Z'),
    ...overrides,
  };
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: {
    eventLog: { findMany: jest.Mock };
    appLog: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let logging: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      eventLog: { findMany: jest.fn().mockResolvedValue([]) },
      appLog: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    logging = { log: jest.fn().mockResolvedValue(null) };
    service = new AuditLogService(prisma as never, logging as never);
  });

  // ─── Date ranges ───────────────────────────────────────────────────────

  it('defaults to the last 90 days', async () => {
    const page = await service.query({});

    const span =
      new Date(page.to).getTime() - new Date(page.from).getTime();
    expect(span).toBe(90 * 24 * 60 * 60 * 1000);
    expect(page.limit).toBe(25);
  });

  it('rejects invalid and inverted ranges', async () => {
    await expect(
      service.query({ from: 'not-a-date', to: TO }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.query({ from: TO, to: FROM }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires both bounds for ranges longer than 90 days', async () => {
    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

    await expect(
      service.query({ from: longAgo.toISOString() }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.query({
        from: longAgo.toISOString(),
        to: new Date().toISOString(),
      }),
    ).resolves.toBeDefined();
  });

  // ─── Merging, ordering, pagination ─────────────────────────────────────

  it('merges both sources in reverse chronological order', async () => {
    prisma.eventLog.findMany.mockResolvedValue([event()]);
    prisma.appLog.findMany.mockResolvedValue([appLog()]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
      { id: 'user-2', email: 'grace@example.com', firstName: null, lastName: null },
    ]);

    const page = await service.query({ from: FROM, to: TO });

    expect(page.data.map((entry) => entry.id)).toEqual(['app-1', 'evt-1']);
    expect(page.data[0]).toMatchObject({
      source: 'APP',
      action: 'PAYMENT_PAID',
      entityType: 'ESCROW',
      entityId: 'escrow-1',
      requestId: 'req-2',
      level: 'INFO',
      actor: { id: 'user-2', displayName: 'grace@example.com' },
    });
    expect(page.data[1]).toMatchObject({
      source: 'EVENT',
      action: 'ADOPTION_APPROVED',
      entityType: 'ADOPTION',
      entityId: 'adoption-1',
      requestId: 'req-1',
      level: null,
      actor: { id: 'user-1', displayName: 'Ada Lovelace' },
    });
  });

  it('orders ties by id descending', async () => {
    const at = new Date('2026-03-05T10:00:00.000Z');
    prisma.eventLog.findMany.mockResolvedValue([
      event({ id: 'aaa', createdAt: at }),
    ]);
    prisma.appLog.findMany.mockResolvedValue([
      appLog({ id: 'zzz', createdAt: at }),
    ]);

    const page = await service.query({ from: FROM, to: TO });

    expect(page.data.map((entry) => entry.id)).toEqual(['zzz', 'aaa']);
  });

  it('paginates with a cursor across both sources', async () => {
    const at = new Date('2026-03-05T10:00:00.000Z');
    prisma.eventLog.findMany.mockResolvedValueOnce([
      event({ id: 'evt-1', createdAt: at }),
      event({ id: 'evt-2', createdAt: new Date(at.getTime() - 1000) }),
    ]);
    prisma.appLog.findMany.mockResolvedValueOnce([
      appLog({ id: 'app-1', createdAt: new Date(at.getTime() + 1000) }),
      appLog({ id: 'app-2', createdAt: new Date(at.getTime() - 2000) }),
    ]);

    const first = await service.query({ from: FROM, to: TO, limit: 2 });

    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    prisma.eventLog.findMany.mockResolvedValueOnce([]);
    prisma.appLog.findMany.mockResolvedValueOnce([]);
    await service.query({
      from: FROM,
      to: TO,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    const eventWhere = prisma.eventLog.findMany.mock.calls[1][0].where;
    const appWhere = prisma.appLog.findMany.mock.calls[1][0].where;
    expect(eventWhere.OR).toBeDefined();
    expect(appWhere.OR).toBeDefined();
    expect(prisma.eventLog.findMany.mock.calls[1][0].take).toBe(3);
  });

  it('returns no cursor when everything fits on one page', async () => {
    prisma.eventLog.findMany.mockResolvedValue([event()]);
    prisma.appLog.findMany.mockResolvedValue([appLog()]);

    const page = await service.query({ from: FROM, to: TO, limit: 5 });

    expect(page.nextCursor).toBeNull();
  });

  it('rejects malformed cursors', async () => {
    await expect(
      service.query({ from: FROM, to: TO, cursor: 'garbage' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const malformed = Buffer.from(JSON.stringify({ t: 'nope' })).toString(
      'base64url',
    );
    await expect(
      service.query({ from: FROM, to: TO, cursor: malformed }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── Filters ───────────────────────────────────────────────────────────

  it('filters by actor on both sources', async () => {
    await service.query({ from: FROM, to: TO, actorId: 'user-9' });

    expect(prisma.eventLog.findMany.mock.calls[0][0].where.actorId).toBe('user-9');
    expect(prisma.appLog.findMany.mock.calls[0][0].where.userId).toBe('user-9');
  });

  it('matches app actions exactly and skips event logs for unknown actions', async () => {
    await service.query({ from: FROM, to: TO, action: 'PAYMENT_PAID' });

    expect(prisma.eventLog.findMany).not.toHaveBeenCalled();
    expect(prisma.appLog.findMany.mock.calls[0][0].where.action).toBe(
      'PAYMENT_PAID',
    );
  });

  it('matches event types for known actions', async () => {
    await service.query({ from: FROM, to: TO, action: 'ESCROW_FUNDED' });

    expect(prisma.eventLog.findMany.mock.calls[0][0].where.eventType).toBe(
      'ESCROW_FUNDED',
    );
    expect(prisma.appLog.findMany.mock.calls[0][0].where.action).toBe(
      'ESCROW_FUNDED',
    );
  });

  it('filters entity type on events and JSON metadata on app logs', async () => {
    await service.query({ from: FROM, to: TO, entityType: 'ESCROW' });

    expect(prisma.eventLog.findMany.mock.calls[0][0].where.entityType).toBe(
      'ESCROW',
    );
    expect(prisma.appLog.findMany.mock.calls[0][0].where.metadata).toEqual({
      path: ['entityType'],
      equals: 'ESCROW',
    });
  });

  it('skips event logs for unknown entity types', async () => {
    await service.query({ from: FROM, to: TO, entityType: 'NOT_A_TABLE' });

    expect(prisma.eventLog.findMany).not.toHaveBeenCalled();
    expect(prisma.appLog.findMany).toHaveBeenCalled();
  });

  // ─── Sanitisation, actors, self-audit ──────────────────────────────────

  it('sanitises metadata from both sources', async () => {
    prisma.eventLog.findMany.mockResolvedValue([event()]);
    prisma.appLog.findMany.mockResolvedValue([appLog()]);

    const page = await service.query({ from: FROM, to: TO });
    const [appEntry, eventEntry] = page.data;

    expect(appEntry.metadata).toMatchObject({
      entityType: 'ESCROW',
      password: '[REDACTED]',
    });
    expect(eventEntry.metadata).toMatchObject({
      payload: { adoptionId: 'adoption-1', password: '[REDACTED]' },
      requestId: 'req-1',
    });
  });

  it('labels unknown actors as deleted users and handles missing actors', async () => {
    prisma.eventLog.findMany.mockResolvedValue([
      event({ id: 'evt-ghost', actorId: 'ghost' }),
      event({ id: 'evt-anon', actorId: null }),
    ]);

    const page = await service.query({ from: FROM, to: TO });

    expect(page.data[0].actor).toEqual({
      id: 'ghost',
      displayName: 'Deleted user',
    });
    expect(page.data[1].actor).toBeNull();
  });

  it('does not query users when no entry has an actor', async () => {
    prisma.appLog.findMany.mockResolvedValue([appLog({ userId: null })]);
    const page = await service.query({ from: FROM, to: TO });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(page.data[0].actor).toBeNull();
  });

  it('records the access itself with the query context', async () => {
    await service.query(
      { from: FROM, to: TO, limit: 10, action: 'PAYMENT_PAID' },
      { userId: 'auditor-1', requestId: 'req-audit' },
    );

    expect(logging.log).toHaveBeenCalledWith({
      level: 'INFO',
      action: 'AUDIT_LOG_ACCESSED',
      message: expect.stringContaining('entries'),
      userId: 'auditor-1',
      metadata: expect.objectContaining({
        requestId: 'req-audit',
        from: new Date(FROM).toISOString(),
        to: new Date(TO).toISOString(),
        limit: 10,
        action: 'PAYMENT_PAID',
        returned: 0,
      }),
    });
  });
});
