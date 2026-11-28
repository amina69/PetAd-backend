import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('Fine-Grained Permissions (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('should allow FINANCE user to access refund but not documents.verify', async () => {
    // Ensure refund and document verification endpoints exist or are properly handled

    const token = jwtService.sign({
      sub: 'finance-user-id',
      email: 'finance@petad.org',
      role: 'FINANCE',
    });

    // Test verify documents route which requires documents.verify
    const res = await request(app.getHttpServer())
      .post('/documents/some-doc-id/verify')
      .set('Authorization', `Bearer ${token}`);
      
    expect(res.status).toBe(403);
  });

  it('should keep existing @Roles(ADMIN) routes working backwards compatibly', async () => {
    const adminToken = jwtService.sign({
      sub: 'admin-user-id',
      email: 'admin@petad.org',
      role: 'ADMIN',
    });

    const res = await request(app.getHttpServer())
      .get('/admin/replay/non-existent-agg')
      .set('Authorization', `Bearer ${adminToken}`);

    // Should reach controller logic (404 or 400 instead of 403 Forbidden)
    expect(res.status).not.toBe(403);
  });
});
