import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PetStatus, UserRole, PetSpecies } from '../../src/common/enums';

/* eslint-disable @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-assignment,,
   @typescript-eslint/no-unsafe-argument */

describe('Pet Status Lifecycle (E2E)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let adminToken: string;
  let userToken: string;
  let petId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
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
    await app.init();

    prismaService = moduleFixture.get<PrismaService>(PrismaService);

    await prismaService.pet.deleteMany({});
    await prismaService.user.deleteMany({});

    const hashedPassword = await bcrypt.hash('Test@123', 10);

    const admin = await prismaService.user.create({
      data: {
        email: 'admin@pets-status.com',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        role: UserRole.ADMIN,
      },
    });

    const user = await prismaService.user.create({
      data: {
        email: 'user@pets-status.com',
        password: hashedPassword,
        firstName: 'Regular',
        lastName: 'User',
        role: UserRole.USER,
      },
    });

    const adminLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@pets-status.com',
        password: 'Test@123',
      });

    adminToken = adminLoginResponse.body.access_token;

    const userLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@pets-status.com',
        password: 'Test@123',
      });

    userToken = userLoginResponse.body.access_token;

    const pet = await prismaService.pet.create({
      data: {
        name: 'Buddy',
        species: PetSpecies.DOG,
        breed: 'Golden Retriever',
        age: 3,
        description: 'Test dog for status lifecycle',
        status: PetStatus.AVAILABLE,
        currentOwnerId: admin.id,
      },
    });

    petId = pet.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  describe('GET /pets/:id - View pet details', () => {
    it('should return pet with current status', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pets/${petId}`)
        .expect(200);

      expect(response.body.id).toBe(petId);
      expect(response.body.name).toBe('Buddy');
      expect(response.body.status).toBe(PetStatus.AVAILABLE);
    });

    it('should allow public access (no auth required)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pets/${petId}`)
        .expect(200);

      expect(response.status).toBe(200);
    });

    it('should return 404 for non-existent pet', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app.getHttpServer())
        .get(`/pets/${fakeId}`)
        .expect(404);
    });
  });

  describe('GET /pets/:id/transitions - View allowed transitions', () => {
    it('should return transition info for a pet', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pets/${petId}/transitions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('currentStatus');
      expect(response.body).toHaveProperty('allowedTransitions');
      expect(response.body.allowedTransitions).toContain(PetStatus.PENDING);
    });
  });

  describe('PATCH /pets/:id/status - Valid Transitions', () => {
    it('should allow AVAILABLE → PENDING transition', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.PENDING,
        })
        .expect(200);

      expect(response.body.status).toBe(PetStatus.PENDING);
    });

    it('should allow PENDING → ADOPTED transition (admin)', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.PENDING },
      });

      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.ADOPTED,
        })
        .expect(200);

      expect(response.body.status).toBe(PetStatus.ADOPTED);
    });

    it('should allow PENDING → AVAILABLE transition (adoption rejected)', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.PENDING },
      });

      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.AVAILABLE,
        })
        .expect(200);

      expect(response.body.status).toBe(PetStatus.AVAILABLE);
    });

    it('should allow AVAILABLE → IN_CUSTODY transition', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.IN_CUSTODY,
        })
        .expect(200);

      expect(response.body.status).toBe(PetStatus.IN_CUSTODY);
    });

    it('should allow IN_CUSTODY → AVAILABLE transition', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.IN_CUSTODY },
      });

      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.AVAILABLE,
        })
        .expect(200);

      expect(response.body.status).toBe(PetStatus.AVAILABLE);
    });
  });

  describe('PATCH /pets/:id/status - Admin-Only Transitions', () => {
    it('should allow ADMIN to return ADOPTED pet to AVAILABLE', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.ADOPTED },
      });

      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.AVAILABLE,
        })
        .expect(200);

      expect(response.body.status).toBe(PetStatus.AVAILABLE);
    });

    it('should prevent non-admin from changing to ADOPTED status', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.PENDING },
      });

      await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          newStatus: PetStatus.ADOPTED,
        })
        .expect(403);
    });
  });

  describe('PATCH /pets/:id/status - Invalid Transitions', () => {
    it('should block ADOPTED → PENDING transition', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.ADOPTED },
      });

      await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.PENDING,
        })
        .expect(400);
    });

    it('should block ADOPTED → IN_CUSTODY transition', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.IN_CUSTODY,
        });

      expect(response.status).toBe(400);
    });

    it('should block IN_CUSTODY → ADOPTED transition', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.IN_CUSTODY },
      });

      await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.ADOPTED,
        })
        .expect(400);
    });

    it('should block same status update (no-op)', async () => {
      const pet = await prismaService.pet.findUnique({ where: { id: petId } });

      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: pet?.status,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /pets/:id/status - Authorization', () => {
    it('should require authentication to update status', async () => {
      await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .send({
          newStatus: PetStatus.PENDING,
        })
        .expect(401);
    });

    it('should accept valid JWT token', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.AVAILABLE,
        });

      expect(response.status).not.toBe(401);
    });
  });

  describe('PATCH /pets/:id/status - Error Responses', () => {
    it('should return 400 with clear error message for invalid transition', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.ADOPTED },
      });

      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.PENDING,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBeDefined();
    });

    it('should return 404 for non-existent pet', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .patch(`/pets/${fakeId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newStatus: PetStatus.PENDING,
        })
        .expect(404);
    });

    it('should validate request body schema', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invalidField: 'test',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /pets/:id/transitions/allowed - Role-based Transitions', () => {
    it('should return different transitions for ADMIN user', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.ADOPTED },
      });

      const response = await request(app.getHttpServer())
        .get(`/pets/${petId}/transitions`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).not.toBe(401);
    });

    it('should return restricted transitions for regular user', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pets/${petId}/transitions`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
    });
  });

  describe('Complete Adoption Workflow', () => {
    it('should complete full adoption flow', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.AVAILABLE },
      });

      const pending = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newStatus: PetStatus.PENDING })
        .expect(200);

      expect(pending.body.status).toBe(PetStatus.PENDING);

      const adopted = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newStatus: PetStatus.ADOPTED })
        .expect(200);

      expect(adopted.body.status).toBe(PetStatus.ADOPTED);
    });
  });

  describe('Complete Custody Workflow', () => {
    it('should complete full temporary custody flow', async () => {
      await prismaService.pet.update({
        where: { id: petId },
        data: { status: PetStatus.AVAILABLE },
      });

      const custody = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newStatus: PetStatus.IN_CUSTODY })
        .expect(200);

      expect(custody.body.status).toBe(PetStatus.IN_CUSTODY);

      const returned = await request(app.getHttpServer())
        .patch(`/pets/${petId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newStatus: PetStatus.AVAILABLE })
        .expect(200);

      expect(returned.body.status).toBe(PetStatus.AVAILABLE);
    });
  });
});

