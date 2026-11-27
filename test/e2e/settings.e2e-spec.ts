import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserRole } from '../../src/common/enums/user-role.enum';

describe('System Settings (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

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
    prisma = moduleFixture.get(PrismaService);
    await app.init();

    const email = `settings_admin_${Date.now()}@test.com`;
    const password = 'StrongPassword123';
    await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password,
      firstName: 'Settings',
      lastName: 'Admin',
    });

    await prisma.user.update({
      where: { email },
      data: { role: UserRole.ADMIN },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    adminToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('/settings (GET) should list all settings', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('escrow_timeout_hours');
  });

  it('/settings/:key (PATCH) should reject invalid values (wrong type/range)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/settings/escrow_timeout_hours')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: -5, reason: 'invalid range' })
      .expect(400);

    expect(res.body.message).toMatch(/Invalid value/);
  });

  it('/settings/:key (PATCH) and rollback should restore exact previous value and audit', async () => {
    // Update to 96
    await request(app.getHttpServer())
      .patch('/settings/escrow_timeout_hours')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 96, reason: 'First update' })
      .expect(200);

    // Update to 120
    await request(app.getHttpServer())
      .patch('/settings/escrow_timeout_hours')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 120, reason: 'Second update' })
      .expect(200);

    // Check versions
    const versionsRes = await request(app.getHttpServer())
      .get('/settings/escrow_timeout_hours/versions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(versionsRes.body.length).toBeGreaterThanOrEqual(2);
    const firstVersionNum = versionsRes.body[versionsRes.body.length - 1].version;

    // Rollback to first version (value 96)
    const rollbackRes = await request(app.getHttpServer())
      .patch('/settings/escrow_timeout_hours/rollback')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: firstVersionNum, reason: 'Rolling back' })
      .expect(200);

    expect(rollbackRes.body.setting.value).toBe('96');

    // Verify current get value is 96
    const getRes = await request(app.getHttpServer())
      .get('/settings/escrow_timeout_hours')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(getRes.body.value).toBe(96);
  });
});
