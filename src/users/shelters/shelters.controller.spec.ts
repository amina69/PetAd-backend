import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Global,
  INestApplication,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SheltersModule } from './shelters.module';
import { ShelterVerificationGuard } from './shelter-verification.guard';
import { NotificationQueueService } from '../../jobs/services/notification-queue.service';

process.env.JWT_SECRET = 'super-secret-test-key';

/**
 * Acceptance tests for [BE-025] Shelter onboarding and verification.
 * Mirrors the guard chain on POST /pets (JwtAuthGuard + RolesGuard +
 * ShelterVerificationGuard) with a minimal publishing controller.
 */
@Controller('publish-test')
@UseGuards(JwtAuthGuard, RolesGuard, ShelterVerificationGuard)
class PublishingTestController {
  @Post()
  @Roles('SHELTER', 'ADMIN')
  publish() {
    return { published: true };
  }
}

describe('SheltersController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockNotificationQueue = {
    enqueueSendTransactionalEmail: jest.fn(),
  };

  @Global()
  @Module({
    providers: [
      { provide: NotificationQueueService, useValue: mockNotificationQueue },
    ],
    exports: [NotificationQueueService],
  })
  class MockNotificationQueueModule {}

  const uniqueEmail = () =>
    `shelter+${Date.now()}+${Math.random()}@example.com`;

  const register = async (email: string) =>
    request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'StrongPass123',
      firstName: 'Test',
      lastName: 'Shelter',
    });

  const login = async (email: string) =>
    request(app.getHttpServer()).post('/auth/login').send({
      email,
      password: 'StrongPass123',
    });

  interface AuthResponseBody {
    access_token: string;
    user: { id: string; role: string };
  }

  interface ApplyResponseBody {
    id: string;
  }

  type EnqueueCall = [{ dto: { to: string; text: string } }];

  const enqueuedNotification = (index = 0) => {
    const enqueueMock =
      mockNotificationQueue.enqueueSendTransactionalEmail as jest.Mock<
        Promise<unknown>,
        EnqueueCall
      >;
    return enqueueMock.mock.calls[index][0];
  };

  const applyDto = {
    orgName: 'Hope Paws Shelter',
    registrationNumber: 'REG-12345',
    address: '12 Charity Lane, Lagos',
    phone: '+2348012345678',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        JwtModule.register({
          secret: 'testsecret',
          signOptions: { expiresIn: '1d' },
        }),
        AuthModule,
        SheltersModule,
        MockNotificationQueueModule,
      ],
      controllers: [PublishingTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: 'shelter+' } },
    });
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationQueue.enqueueSendTransactionalEmail.mockResolvedValue({});
  });

  it('runs the full onboarding flow: apply, blocked publish, verify, publish, badge', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const token = (reg.body as AuthResponseBody).access_token;
    const userId = (reg.body as AuthResponseBody).user.id;

    // 1. Unverified user cannot publish -> 403 (role guard: USER not allowed)
    const blocked = await request(app.getHttpServer())
      .post('/publish-test')
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);

    // 2. Apply for shelter onboarding
    const applyRes = await request(app.getHttpServer())
      .post('/shelters/apply')
      .set('Authorization', `Bearer ${token}`)
      .send(applyDto);
    expect(applyRes.status).toBe(201);
    expect(applyRes.body).toMatchObject({
      userId,
      orgName: applyDto.orgName,
      verificationStatus: 'PENDING',
      isVerified: false,
    });
    const profileId = (applyRes.body as ApplyResponseBody).id;

    // Applicant is promoted to SHELTER; re-login picks up the new role claim.
    const applicant = await prisma.user.findUnique({ where: { id: userId } });
    expect(applicant?.role).toBe('SHELTER');

    const shelterLogin = await login(email);
    const shelterToken = (shelterLogin.body as AuthResponseBody).access_token;

    // Unverified shelter (PENDING) cannot publish -> 403 SHELTER_NOT_VERIFIED
    const stillBlocked = await request(app.getHttpServer())
      .post('/publish-test')
      .set('Authorization', `Bearer ${shelterToken}`);
    expect(stillBlocked.status).toBe(403);
    expect(stillBlocked.body).toMatchObject({ code: 'SHELTER_NOT_VERIFIED' });

    // 3. Duplicate application -> 409
    const duplicate = await request(app.getHttpServer())
      .post('/shelters/apply')
      .set('Authorization', `Bearer ${token}`)
      .send(applyDto);
    expect(duplicate.status).toBe(409);

    // 4. Admin verifies the shelter
    const adminEmail = uniqueEmail();
    await register(adminEmail);
    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await login(adminEmail);
    const adminToken = (adminLogin.body as AuthResponseBody).access_token;

    const verifyRes = await request(app.getHttpServer())
      .patch(`/shelters/${profileId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toMatchObject({
      verificationStatus: 'APPROVED',
      isVerified: true,
    });

    // 5. Verification emitted a SHELTER_VERIFIED event and a notification
    const event = await prisma.eventLog.findFirst({
      where: { eventType: 'SHELTER_VERIFIED', entityId: userId },
    });
    expect(event).not.toBeNull();
    expect(
      mockNotificationQueue.enqueueSendTransactionalEmail,
    ).toHaveBeenCalledTimes(1);
    expect(enqueuedNotification().dto.to).toBe(email);

    // 6. Verified shelter can now publish (same SHELTER token as before)
    const published = await request(app.getHttpServer())
      .post('/publish-test')
      .set('Authorization', `Bearer ${shelterToken}`);
    expect(published.status).toBe(201);

    // 7. Public profile exposes the verified badge
    const publicProfile = await request(app.getHttpServer()).get(
      `/shelters/${profileId}`,
    );
    expect(publicProfile.status).toBe(200);
    expect(publicProfile.body).toMatchObject({
      orgName: applyDto.orgName,
      verificationStatus: 'APPROVED',
      isVerified: true,
    });
  });

  it('rejects an application and blocks publishing afterwards', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const token = (reg.body as AuthResponseBody).access_token;
    const userId = (reg.body as AuthResponseBody).user.id;

    const applyRes = await request(app.getHttpServer())
      .post('/shelters/apply')
      .set('Authorization', `Bearer ${token}`)
      .send(applyDto);
    const profileId = (applyRes.body as ApplyResponseBody).id;

    const adminEmail = uniqueEmail();
    await register(adminEmail);
    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await login(adminEmail);
    const adminToken = (adminLogin.body as AuthResponseBody).access_token;

    const rejectRes = await request(app.getHttpServer())
      .patch(`/shelters/${profileId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Registration number could not be confirmed' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body).toMatchObject({
      verificationStatus: 'REJECTED',
      isVerified: false,
    });

    // Rejected shelter still cannot publish (fresh SHELTER role claim)
    const shelterLogin = await login(email);
    const shelterToken = (shelterLogin.body as AuthResponseBody).access_token;
    const blocked = await request(app.getHttpServer())
      .post('/publish-test')
      .set('Authorization', `Bearer ${shelterToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'SHELTER_NOT_VERIFIED' });

    // Rejection notification was enqueued with the reason
    expect(enqueuedNotification().dto.text).toContain(
      'Registration number could not be confirmed',
    );
    expect(userId).toBeDefined();
  });

  it('requires admin role for verify and reject', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const token = (reg.body as AuthResponseBody).access_token;

    const applyRes = await request(app.getHttpServer())
      .post('/shelters/apply')
      .set('Authorization', `Bearer ${token}`)
      .send(applyDto);
    const profileId = (applyRes.body as ApplyResponseBody).id;

    const verifyRes = await request(app.getHttpServer())
      .patch(`/shelters/${profileId}/verify`)
      .set('Authorization', `Bearer ${token}`);
    expect(verifyRes.status).toBe(403);

    const rejectRes = await request(app.getHttpServer())
      .patch(`/shelters/${profileId}/reject`)
      .set('Authorization', `Bearer ${token}`);
    expect(rejectRes.status).toBe(403);
  });
});
