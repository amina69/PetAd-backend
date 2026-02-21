import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response } from 'supertest';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthController (e2e)', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test users before each test to ensure isolation
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            'testuser@example.com',
            'dupe@example.com',
            'not-an-email',
            'weakpass@example.com',
          ],
        },
      },
    });
  });

  it('should register a new user and return JWT', async () => {
    const uniqueEmail = `testuser+${Date.now()}@example.com`;
    const res: Response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: uniqueEmail,
        password: 'StrongPass123',
        firstName: 'Test',
        lastName: 'User',
      });
    const body = res.body as {
      access_token: string;
      user: { email: string; role: string };
    };
    expect(res.status).toBe(201);
    expect(body).toHaveProperty('access_token');
    expect(body.user).toMatchObject({
      email: uniqueEmail,
      role: 'USER',
    });
  });

  it('should reject duplicate email registration', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'dupe@example.com',
      password: 'StrongPass123',
      firstName: 'Dupe',
      lastName: 'User',
    });
    const res: Response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'dupe@example.com',
        password: 'StrongPass123',
        firstName: 'Dupe',
        lastName: 'User',
      });
    const body = res.body as { message: string };
    expect(res.status).toBe(409);
    expect(body.message).toMatch(/already registered/i);
  });

  it('should reject invalid email', async () => {
    const res: Response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'not-an-email',
        password: 'StrongPass123',
        firstName: 'Bad',
        lastName: 'Email',
      });
    const body = res.body as { message: string };
    expect(res.status).toBe(400);
    expect(body.message).toContain('email must be an email');
  });

  it('should reject weak password', async () => {
    const res: Response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'weakpass@example.com',
        password: '123',
        firstName: 'Weak',
        lastName: 'Pass',
      });
    const body = res.body as { message: string };
    expect(res.status).toBe(400);
    expect(body.message).toContain(
      'password must be longer than or equal to 8 characters',
    );
  });
});
