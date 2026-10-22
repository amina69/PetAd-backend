import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RequireVerifiedEmail } from './decorators/require-verified-email.decorator';
import { EmailVerificationService } from './email-verification.service';

process.env.JWT_SECRET = 'super-secret-test-key';

/**
 * Acceptance tests for [BE-015] Email verification flow:
 * - Unverified users get 403 EMAIL_NOT_VERIFIED on gated routes
 * - Resend within the 60s cooldown returns 429 with Retry-After
 */
@Controller('gated-test')
@UseGuards(JwtAuthGuard)
class GatedTestController {
  @Get()
  @RequireVerifiedEmail()
  index() {
    return { ok: true };
  }
}

describe('Email verification flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const uniqueEmail = () => `verify+${Date.now()}+${Math.random()}@example.com`;

  const register = async (email: string) =>
    request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'StrongPass123',
      firstName: 'Test',
      lastName: 'User',
    });

  interface RegisterResponseBody {
    access_token: string;
    user: { id: string };
  }

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
      ],
      controllers: [GatedTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: 'verify+' } },
    });
    await app.close();
  });

  it('blocks unverified users on gated routes with 403 EMAIL_NOT_VERIFIED', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const token = (reg.body as RegisterResponseBody).access_token;

    const res = await request(app.getHttpServer())
      .get('/gated-test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('verifies the email via POST /auth/email/verify and unlocks gated routes', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const { access_token: token, user: regUser } =
      reg.body as RegisterResponseBody;
    const userId = regUser.id;

    // Simulate the emailed token: persist a fresh one and keep the raw value.
    const verificationService = app.get(EmailVerificationService);
    const rawToken = await verificationService.issueToken(userId);

    const verifyRes = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: rawToken });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toMatchObject({
      message: 'Email verified successfully',
      email,
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerifiedAt).not.toBeNull();

    const gated = await request(app.getHttpServer())
      .get('/gated-test')
      .set('Authorization', `Bearer ${token}`);
    expect(gated.status).toBe(200);
  });

  it('rejects an invalid verification token with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: 'definitely-not-a-token' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_VERIFICATION_TOKEN' });
  });

  it('returns 429 with Retry-After when resending within the cooldown', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const token = (reg.body as RegisterResponseBody).access_token;

    // Registration already sent a verification email; expire that cooldown
    // so the first resend below is legitimately allowed.
    await prisma.user.update({
      where: { id: (reg.body as RegisterResponseBody).user.id },
      data: { emailVerificationSentAt: new Date(Date.now() - 120_000) },
    });

    const first = await request(app.getHttpServer())
      .post('/auth/email/resend')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'sent' });

    const second = await request(app.getHttpServer())
      .post('/auth/email/resend')
      .set('Authorization', `Bearer ${token}`);

    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ code: 'RESEND_COOLDOWN' });
    const retryAfter = Number(second.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('reports already_verified on resend after verification', async () => {
    const email = uniqueEmail();
    const reg = await register(email);
    const { access_token: token, user: regUser } =
      reg.body as RegisterResponseBody;
    const userId = regUser.id;

    // Expire the cooldown so resend is allowed, then verify.
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerificationSentAt: new Date(Date.now() - 120_000) },
    });
    const verificationService = app.get(EmailVerificationService);
    const rawToken = await verificationService.issueToken(userId);
    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: rawToken });

    const res = await request(app.getHttpServer())
      .post('/auth/email/resend')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'already_verified' });
  });

  it('requires authentication for resend', async () => {
    const res = await request(app.getHttpServer()).post('/auth/email/resend');
    expect(res.status).toBe(401);
  });
});
