import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { Role } from '../../src/auth/enums/role.enum';

describe('Audit log API (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const canaryPassword = `canary-password-${suffix}`;
  const canaryToken = `canary-token-${suffix}`;
  const bcryptCanary = `$2b$12$${'a'.repeat(53)}`;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(app.get(HttpExceptionFilter));
    app.use(
      (
        req: { headers: Record<string, unknown>; requestId?: string },
        _res: unknown,
        next: () => void,
      ) => {
        req.requestId =
          (req.headers['x-request-id'] as string | undefined) ??
          `e2e-${suffix}`;
        next();
      },
    );
    prisma = app.get(PrismaService);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createUserWithRole(
    role: Role,
  ): Promise<{ token: string; userId: string; email: string }> {
    const email = `audit_${role.toLowerCase()}_${suffix}_${Math.random()
      .toString(36)
      .slice(2, 6)}@example.com`;
    const password = 'StrongPass123';

    await request(server)
      .post('/auth/register')
      .send({ email, password, firstName: 'Audit', lastName: role })
      .expect(201);

    const user = await prisma.user.update({
      where: { email },
      data: { role },
    });

    const login = await request(server)
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    return {
      token: login.body.access_token as string,
      userId: user.id,
      email,
    };
  }

  it('allows ADMIN and AUDITOR, and forbids regular users', async () => {
    const regular = await createUserWithRole(Role.USER);
    const admin = await createUserWithRole(Role.ADMIN);
    const auditor = await createUserWithRole(Role.AUDITOR);

    await request(server)
      .get('/admin/audit-log')
      .set('Authorization', `Bearer ${regular.token}`)
      .expect(403);

    await request(server).get('/admin/audit-log').expect(401);

    for (const actor of [admin, auditor]) {
      const response = await request(server)
        .get('/admin/audit-log')
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);

      expect(response.body.limit).toBe(25);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(typeof response.body.from).toBe('string');
      expect(typeof response.body.to).toBe('string');
    }
  });

  it('merges event and app logs, resolves actors, and sanitises secrets', async () => {
    const admin = await createUserWithRole(Role.ADMIN);
    const actor = await createUserWithRole(Role.USER);

    await prisma.user.update({
      where: { id: actor.userId },
      data: { firstName: 'Audit', lastName: 'Subject' },
    });

    const canaryAction = `AUDIT_CANARY_${suffix}`;
    await prisma.appLog.create({
      data: {
        level: 'INFO',
        action: canaryAction,
        message: 'canary log',
        userId: actor.userId,
        metadata: {
          entityType: 'PAYMENT',
          entityId: 'payment-canary',
          requestId: `req-${suffix}`,
          password: canaryPassword,
          token: canaryToken,
          note: bcryptCanary,
          nested: { secret: canaryPassword },
        },
      },
    });

    await prisma.eventLog.create({
      data: {
        entityType: 'USER',
        entityId: actor.userId,
        eventType: 'USER_REGISTERED',
        actorId: actor.userId,
        payload: {
          email: actor.email,
          password: canaryPassword,
        },
        metadata: { requestId: `evt-${suffix}` },
      },
    });

    const appResponse = await request(server)
      .get('/admin/audit-log')
      .query({ action: canaryAction, actorId: actor.userId })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    expect(appResponse.body.data).toHaveLength(1);
    const appEntry = appResponse.body.data[0];
    expect(appEntry).toMatchObject({
      source: 'APP',
      action: canaryAction,
      entityType: 'PAYMENT',
      entityId: 'payment-canary',
      requestId: `req-${suffix}`,
      actor: { id: actor.userId, displayName: 'Audit Subject' },
    });
    expect(appEntry.metadata.password).toBe('[REDACTED]');
    expect(appEntry.metadata.token).toBe('[REDACTED]');
    expect(appEntry.metadata.note).toBe('[REDACTED]');
    expect(appEntry.metadata.nested.secret).toBe('[REDACTED]');

    const serialisedApp = JSON.stringify(appResponse.body);
    expect(serialisedApp).not.toContain(canaryPassword);
    expect(serialisedApp).not.toContain(canaryToken);
    expect(serialisedApp).not.toContain(bcryptCanary);

    const entityResponse = await request(server)
      .get('/admin/audit-log')
      .query({
        action: canaryAction,
        actorId: actor.userId,
        entityType: 'PAYMENT',
      })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    expect(entityResponse.body.data).toHaveLength(1);
    expect(entityResponse.body.data[0].entityId).toBe('payment-canary');

    const eventResponse = await request(server)
      .get('/admin/audit-log')
      .query({
        action: 'USER_REGISTERED',
        actorId: actor.userId,
        entityType: 'USER',
      })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    const eventEntry = eventResponse.body.data.find(
      (entry: { entityId: string }) => entry.entityId === actor.userId,
    );
    expect(eventEntry).toBeDefined();
    expect(eventEntry.source).toBe('EVENT');
    expect(eventEntry.metadata.payload.password).toBe('[REDACTED]');
    expect(eventEntry.requestId).toBe(`evt-${suffix}`);
    expect(JSON.stringify(eventEntry)).not.toContain(canaryPassword);
  });

  it('enforces the 90-day rule, the limit bound, and cursor pagination', async () => {
    const admin = await createUserWithRole(Role.ADMIN);
    const actor = await createUserWithRole(Role.USER);
    const action = `AUDIT_PAGING_${suffix}`;

    for (let index = 0; index < 3; index += 1) {
      await prisma.appLog.create({
        data: {
          level: 'INFO',
          action,
          message: `paging ${index}`,
          userId: actor.userId,
          metadata: { entityType: 'PAYMENT', requestId: `page-${index}` },
        },
      });
    }

    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    await request(server)
      .get('/admin/audit-log')
      .query({ from: longAgo.toISOString() })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(400);

    await request(server)
      .get('/admin/audit-log')
      .query({ limit: 101 })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(400);

    await request(server)
      .get('/admin/audit-log')
      .query({ cursor: 'not-a-cursor' })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(400);

    const first = await request(server)
      .get('/admin/audit-log')
      .query({ action, actorId: actor.userId, limit: 2 })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    expect(first.body.data).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(server)
      .get('/admin/audit-log')
      .query({
        action,
        actorId: actor.userId,
        limit: 2,
        cursor: first.body.nextCursor,
      })
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    expect(second.body.data).toHaveLength(1);

    const ids = new Set([
      ...first.body.data.map((entry: { id: string }) => entry.id),
      ...second.body.data.map((entry: { id: string }) => entry.id),
    ]);
    expect(ids.size).toBe(3);
  });

  it('logs every audit-log access with its request id', async () => {
    const admin = await createUserWithRole(Role.ADMIN);
    const requestId = `audit-access-${suffix}`;

    await request(server)
      .get('/admin/audit-log')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${admin.token}`)
      .set('X-Request-Id', requestId)
      .expect(200);

    const accessLog = await prisma.appLog.findFirst({
      where: {
        action: 'AUDIT_LOG_ACCESSED',
        metadata: { path: ['requestId'], equals: requestId },
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(accessLog).not.toBeNull();
    expect(accessLog?.userId).toBe(admin.userId);
    expect(accessLog?.message).toContain('Audit log queried');
  });
});
