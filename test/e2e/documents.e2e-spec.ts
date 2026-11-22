import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { CloudinaryService } from '../../src/cloudinary/cloudinary.service';

describe('Documents E2E (upload -> scan -> verify -> download)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let cloudinary: { uploadDocument: jest.Mock; destroyAsset: jest.Mock };

  let userToken: string;
  let userId: string;
  let adminToken: string;
  let adminId: string;
  let testAdoptionId: string;

  beforeAll(async () => {
    cloudinary = {
      uploadDocument: jest.fn().mockResolvedValue({
        secure_url: 'https://cdn.test/doc.pdf',
        public_id: 'documents/doc',
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
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Create test user and admin
    const user = await prisma.user.create({
      data: {
        email: `doc_user_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Doc',
        lastName: 'User',
        role: 'USER',
      },
    });
    userId = user.id;
    userToken = jwtService.sign({ sub: userId, email: user.email, role: user.role });

    const admin = await prisma.user.create({
      data: {
        email: `doc_admin_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Doc',
        lastName: 'Admin',
        role: 'ADMIN',
      },
    });
    adminId = admin.id;
    adminToken = jwtService.sign({ sub: adminId, email: admin.email, role: admin.role });

    const owner = await prisma.user.create({
      data: {
        email: `doc_owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Doc',
        lastName: 'Owner',
      },
    });

    const pet = await prisma.pet.create({
      data: {
        name: 'DocPet',
        species: 'DOG',
        currentOwnerId: owner.id,
      },
    });

    const adoption = await prisma.adoption.create({
      data: {
        petId: pet.id,
        adopterId: userId,
        ownerId: owner.id,
      },
    });
    testAdoptionId = adoption.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { adoptionId: testAdoptionId } });
    await prisma.adoption.deleteMany({ where: { id: testAdoptionId } });
    await prisma.pet.deleteMany({ where: { name: 'DocPet' } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('should complete upload -> scan -> verify -> download flow', async () => {
    // 1. Upload document
    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${userToken}`)
      .field('adoptionId', testAdoptionId)
      .attach('file', Buffer.from('%PDF-1.4 test document content'), {
        filename: 'adoption_agreement.pdf',
        contentType: 'application/pdf',
      });

    expect([201, 200, 204]).toContain(uploadRes.status);
    const documentId = uploadRes.body.id || uploadRes.body.documentId;
    expect(documentId).toBeDefined();

    // 2. Simulate scanning gate / verification by admin
    const verifyRes = await request(app.getHttpServer())
      .patch(`/documents/${documentId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CLEAN' });

    expect(verifyRes.status).toBe(200);

    // 3. Request signed download URL
    const downloadUrlRes = await request(app.getHttpServer())
      .get(`/documents/${documentId}/download-url`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(downloadUrlRes.status).toBe(200);
    expect(downloadUrlRes.body).toHaveProperty('downloadUrl');
  });
});
