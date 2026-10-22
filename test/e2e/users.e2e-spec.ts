import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CloudinaryService } from '../../src/cloudinary/cloudinary.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-super-secret-jwt-key-for-ci-pipeline';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00]);

interface ApiErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[] | Record<string, unknown>;
  reasons?: { code: string; references: string[] }[];
}

describe('Users profile hardening & account deletion (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let cloudinary: { uploadAvatar: jest.Mock; destroyAsset: jest.Mock };

  const createdUserIds: string[] = [];
  const createdPetIds: string[] = [];
  const createdAdoptionIds: string[] = [];
  const createdEscrowIds: string[] = [];

  beforeAll(async () => {
    cloudinary = {
      uploadAvatar: jest.fn().mockResolvedValue({
        secure_url: 'https://cdn.test/avatar.png',
        public_id: 'users/avatar',
      }),
      destroyAsset: jest.fn().mockResolvedValue(true),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CloudinaryService)
      .useValue(cloudinary)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(app.get(HttpExceptionFilter));

    // Trust the X-Forwarded-For header so each test request gets its own
    // throttler bucket instead of sharing one per IP.
    const httpAdapter = app.getHttpAdapter().getInstance() as {
      set: (setting: string, value: unknown) => void;
    };
    httpAdapter.set('trust proxy', 1);

    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.document.deleteMany({
      where: { adoptionId: { in: createdAdoptionIds } },
    });
    await prisma.adoption.deleteMany({
      where: { id: { in: createdAdoptionIds } },
    });
    await prisma.custody.deleteMany({
      where: { holderId: { in: createdUserIds } },
    });
    await prisma.escrow.deleteMany({
      where: { id: { in: createdEscrowIds } },
    });
    await prisma.pet.deleteMany({ where: { id: { in: createdPetIds } } });
    await prisma.eventLog.deleteMany({
      where: { entityId: { in: createdUserIds } },
    });
    await prisma.appLog.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    await app.close();
  });

  async function createUser(email: string, password = 'StrongPass123') {
    const user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 4),
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+2348012345678',
        bio: 'Pet lover',
        location: 'Lagos',
      },
    });
    createdUserIds.push(user.id);

    const token = await jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { user, token, password };
  }

  function uniqueEmail(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  }

  function auth(token: string, ip: string) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Forwarded-For': ip,
    };
  }

  describe('PATCH /users/:id', () => {
    it('rejects role, trustScore and email in the body (forbidNonWhitelisted)', async () => {
      const { user, token } = await createUser(uniqueEmail('patch'));

      for (const [index, body] of [
        { role: 'ADMIN' },
        { trustScore: 100 },
        { email: 'attacker@example.com' },
      ].entries()) {
        const res = await request(app.getHttpServer())
          .patch(`/users/${user.id}`)
          .set(auth(token, `10.0.0.${index + 1}`))
          .send(body)
          .expect(400);

        const error = res.body as ApiErrorBody;
        const messages = Array.isArray(error.message)
          ? error.message
          : [JSON.stringify(error.message)];
        expect(messages).toContain(
          `property ${Object.keys(body)[0]} should not exist`,
        );
      }

      const stored = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(stored?.role).toBe('USER');
      expect(stored?.trustScore).toBe(50);
      expect(stored?.email).toBe(user.email);
    }, 15000);

    it('accepts the whitelisted profile fields', async () => {
      const { user, token } = await createUser(uniqueEmail('profile'));

      const res = await request(app.getHttpServer())
        .patch(`/users/${user.id}`)
        .set(auth(token, '10.0.1.1'))
        .send({
          firstName: 'Grace',
          lastName: 'Hopper',
          phone: '+2348098765432',
          bio: 'Adopting soon',
          location: 'Abuja',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: user.id,
        firstName: 'Grace',
        lastName: 'Hopper',
        phone: '+2348098765432',
        bio: 'Adopting soon',
        location: 'Abuja',
      });

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.location).toBe('Abuja');
    }, 15000);
  });

  describe('POST /users/:id/avatar', () => {
    it('rejects an SVG upload with 415', async () => {
      const { user, token } = await createUser(uniqueEmail('svg'));

      await request(app.getHttpServer())
        .post(`/users/${user.id}/avatar`)
        .set(auth(token, '10.0.2.1'))
        .attach('avatar', SVG_BYTES, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(415);

      expect(cloudinary.uploadAvatar).not.toHaveBeenCalled();
    }, 15000);

    it('rejects a PNG-renamed executable with 415', async () => {
      const { user, token } = await createUser(uniqueEmail('exe'));

      await request(app.getHttpServer())
        .post(`/users/${user.id}/avatar`)
        .set(auth(token, '10.0.2.2'))
        .attach('avatar', EXE_BYTES, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(415);

      expect(cloudinary.uploadAvatar).not.toHaveBeenCalled();
    }, 15000);

    it('rejects an avatar larger than 5 MB with 413', async () => {
      const { user, token } = await createUser(uniqueEmail('big'));

      const oversized = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(5 * 1024 * 1024),
      ]);

      await request(app.getHttpServer())
        .post(`/users/${user.id}/avatar`)
        .set(auth(token, '10.0.2.4'))
        .attach('avatar', oversized, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(413);

      expect(cloudinary.uploadAvatar).not.toHaveBeenCalled();
    }, 20000);

    it('accepts a real PNG image and stores the public id', async () => {
      const { user, token } = await createUser(uniqueEmail('png'));

      await request(app.getHttpServer())
        .post(`/users/${user.id}/avatar`)
        .set(auth(token, '10.0.2.3'))
        .attach('avatar', PNG_BYTES, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);

      expect(cloudinary.uploadAvatar).toHaveBeenCalledTimes(1);

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.avatarUrl).toBe('https://cdn.test/avatar.png');
      expect(stored?.avatarPublicId).toBe('users/avatar');
    }, 15000);
  });

  describe('DELETE /users/:id', () => {
    it('blocks deletion while a funded escrow exists, with a specific code', async () => {
      const { user, token, password } = await createUser(uniqueEmail('escrow'));
      const other = await createUser(uniqueEmail('counterparty'));

      const pet = await prisma.pet.create({
        data: {
          name: 'Rex',
          species: 'DOG',
          currentOwnerId: other.user.id,
        },
      });
      createdPetIds.push(pet.id);

      const escrow = await prisma.escrow.create({
        data: {
          stellarPublicKey: `ESCROW_E2E_${Date.now()}_${Math.random()}`,
          stellarSecretEncrypted: 'encrypted',
          amount: 100,
          status: 'FUNDED',
        },
      });
      createdEscrowIds.push(escrow.id);

      const adoption = await prisma.adoption.create({
        data: {
          petId: pet.id,
          adopterId: user.id,
          ownerId: other.user.id,
          escrowId: escrow.id,
        },
      });
      createdAdoptionIds.push(adoption.id);

      const res = await request(app.getHttpServer())
        .delete(`/users/${user.id}`)
        .set(auth(token, '10.0.3.1'))
        .send({ password })
        .expect(409);

      const error = res.body as ApiErrorBody;
      expect(error.code).toBe('ACCOUNT_DELETION_BLOCKED');
      expect(error.reasons?.map((reason) => reason.code)).toContain(
        'FUNDED_ESCROW',
      );

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.status).toBe('ACTIVE');
      expect(stored?.email).toBe(user.email);

      await prisma.adoption.delete({ where: { id: adoption.id } });
      await prisma.escrow.delete({ where: { id: escrow.id } });
    }, 20000);

    it('requires a correct password before deleting your own account', async () => {
      const { user, token } = await createUser(uniqueEmail('reauth'));

      await request(app.getHttpServer())
        .delete(`/users/${user.id}`)
        .set(auth(token, '10.0.3.2'))
        .send({ password: 'WrongPassword1' })
        .expect(401);

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.status).toBe('ACTIVE');
    }, 15000);

    it('anonymises the account and leaves no PII behind', async () => {
      const { user, token, password } = await createUser(uniqueEmail('delete'));

      const pet = await prisma.pet.create({
        data: {
          name: 'Buddy',
          species: 'DOG',
          currentOwnerId: user.id,
        },
      });
      createdPetIds.push(pet.id);

      const completedAdoption = await prisma.adoption.create({
        data: {
          petId: pet.id,
          adopterId: user.id,
          ownerId: user.id,
          status: 'COMPLETED',
        },
      });
      createdAdoptionIds.push(completedAdoption.id);

      await prisma.document.create({
        data: {
          fileName: 'contract.pdf',
          fileUrl: 'https://cdn.test/contract.pdf',
          publicId: 'adoptions/contract',
          mimeType: 'application/pdf',
          size: 1024,
          uploadedById: user.id,
          adoptionId: completedAdoption.id,
        },
      });

      await prisma.appLog.create({
        data: {
          level: 'INFO',
          action: 'LOGIN',
          message: `user ${user.email} logged in`,
          userId: user.id,
          metadata: { email: user.email },
        },
      });

      await request(app.getHttpServer())
        .delete(`/users/${user.id}`)
        .set(auth(token, '10.0.3.3'))
        .send({ password })
        .expect(200);

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored).not.toBeNull();
      expect(stored).toMatchObject({
        id: user.id,
        status: 'DELETED',
        email: `deleted+${user.id}@invalid`,
        password: null,
        firstName: null,
        lastName: null,
        phone: null,
        bio: null,
        location: null,
        avatarUrl: null,
        avatarPublicId: null,
        stellarPublicKey: null,
      });
      expect(stored?.deletedAt).toBeInstanceOf(Date);
      // The row and its relationships survive for referential integrity.
      expect(
        await prisma.adoption.count({
          where: { adopterId: user.id },
        }),
      ).toBe(1);

      // No PII in documents
      expect(
        await prisma.document.count({ where: { uploadedById: user.id } }),
      ).toBe(0);
      expect(cloudinary.destroyAsset).toHaveBeenCalledWith(
        'adoptions/contract',
        'raw',
      );

      // No PII in logs
      const logsWithEmail = await prisma.appLog.count({
        where: { message: { contains: user.email } },
      });
      expect(logsWithEmail).toBe(0);

      // Ledger keeps ids only, so replay stays valid
      const event = await prisma.eventLog.findFirst({
        where: { entityId: user.id, eventType: 'USER_DELETED' },
      });
      expect(event).not.toBeNull();
      expect(event?.payload).toEqual({ userId: user.id });
      expect(JSON.stringify(event?.payload)).not.toContain(user.email);
    }, 20000);

    it('refuses a second deletion and blocks login for the deleted account', async () => {
      const email = uniqueEmail('twice');
      const { user, token, password } = await createUser(email);

      await request(app.getHttpServer())
        .delete(`/users/${user.id}`)
        .set(auth(token, '10.0.3.4'))
        .send({ password })
        .expect(200);

      const res = await request(app.getHttpServer())
        .delete(`/users/${user.id}`)
        .set(auth(token, '10.0.3.5'))
        .send({ password })
        .expect(409);

      expect((res.body as ApiErrorBody).code).toBe('ACCOUNT_ALREADY_DELETED');

      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '10.0.4.1')
        .send({ email, password })
        .expect(401);
    }, 20000);
  });
});
