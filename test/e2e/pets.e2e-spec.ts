import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PetSpecies, PetStatus } from '../../src/common/enums';

describe('Pets Availability (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('should return pet as available when no adoption or custody exists', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Owner',
        lastName: 'Test',
      },
    });

    const pet = await prisma.pet.create({
      data: {
        name: 'Buddy',
        species: PetSpecies.DOG,
        currentOwnerId: owner.id,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/pets/${pet.id}`)
      .expect(200);

    expect(res.body.isAvailable).toBe(true);
  });

  it('should return pet as NOT available when active adoption exists', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Owner',
        lastName: 'Two',
      },
    });

    const adopter = await prisma.user.create({
      data: {
        email: `owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Adopter',
        lastName: 'Test',
      },
    });

    const pet = await prisma.pet.create({
      data: {
        name: 'Max',
        species: PetSpecies.DOG,
        currentOwnerId: owner.id,
      },
    });

    await prisma.adoption.create({
      data: {
        petId: pet.id,
        adopterId: adopter.id,
        ownerId: owner.id,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/pets/${pet.id}`)
      .expect(200);

    expect(res.body.isAvailable).toBe(false);
  });

  it('should return pet as NOT available when active custody exists', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Owner',
        lastName: 'Three',
      },
    });

    const holder = await prisma.user.create({
      data: {
        email: `owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Holder',
        lastName: 'Test',
      },
    });

    const pet = await prisma.pet.create({
      data: {
        name: 'Charlie',
        species: PetSpecies.DOG,
        currentOwnerId: owner.id,
      },
    });

    await prisma.custody.create({
      data: {
        petId: pet.id,
        holderId: holder.id,
        type: 'TEMPORARY',
        startDate: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/pets/${pet.id}`)
      .expect(200);

    expect(res.body.isAvailable).toBe(false);
  });

  it('should flag a manually edited status in the availability verifier', async () => {
    const email = `status_admin_${Date.now()}@test.com`;
    const password = 'StrongPass123';
    await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password,
      firstName: 'Status',
      lastName: 'Admin',
    });

    const admin = await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN' },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const token = (login.body as { access_token: string }).access_token;
    const pet = await prisma.pet.create({
      data: {
        name: 'Status verifier fixture',
        species: PetSpecies.DOG,
        currentOwnerId: admin.id,
      },
    });

    try {
      const before = await request(app.getHttpServer())
        .get(`/pets/${pet.id}/availability/verify`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(before.body.isMatch).toBe(true);

      await prisma.pet.update({
        where: { id: pet.id },
        data: { status: PetStatus.ADOPTED },
      });

      const after = await request(app.getHttpServer())
        .get(`/pets/${pet.id}/availability/verify`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body).toMatchObject({
        storedStatus: PetStatus.ADOPTED,
        replayedStatus: PetStatus.AVAILABLE,
        isMatch: false,
      });
    } finally {
      await prisma.pet.delete({ where: { id: pet.id } });
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });
});
