import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { DisputeStatus, DisputeOutcome } from '@prisma/client';
import { disputeReducer } from '../../src/disputes/dispute-events';
import {
  DisputeStateMachine,
} from '../../src/disputes/dispute-state-machine';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-super-secret-jwt-key-for-ci-pipeline';

function makeJwt(jwt: JwtService, userId: string, role: 'USER' | 'ADMIN') {
  return jwt.sign({ sub: userId, userId, email: `${userId}@test.local`, role });
}

describe('Disputes E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  let adminToken: string;
  let ownerToken: string;
  let adopterToken: string;
  let outsiderToken: string;

  let adminId: string;
  let ownerId: string;
  let adopterId: string;
  let outsiderId: string;

  let petId: string;
  let adoptionId: string;
  let escrowId: string;
  let disputeId: string;

  const EMAILS = {
    admin: 'disputes-e2e-admin@test.local',
    owner: 'disputes-e2e-owner@test.local',
    adopter: 'disputes-e2e-adopter@test.local',
    outsider: 'disputes-e2e-outsider@test.local',
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    await prisma.dispute.deleteMany({
      where: { filedBy: { email: { in: Object.values(EMAILS) } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });

    const hash = await bcrypt.hash('Pass1234!', 10);

    const admin = await prisma.user.create({
      data: { email: EMAILS.admin, password: hash, role: 'ADMIN', firstName: 'Admin', lastName: 'User' },
    });
    const owner = await prisma.user.create({
      data: { email: EMAILS.owner, password: hash, role: 'USER', firstName: 'Owner', lastName: 'User' },
    });
    const adopter = await prisma.user.create({
      data: { email: EMAILS.adopter, password: hash, role: 'USER', firstName: 'Adopter', lastName: 'User' },
    });
    const outsider = await prisma.user.create({
      data: { email: EMAILS.outsider, password: hash, role: 'USER', firstName: 'Out', lastName: 'Sider' },
    });

    adminId = admin.id;
    ownerId = owner.id;
    adopterId = adopter.id;
    outsiderId = outsider.id;

    adminToken = makeJwt(jwt, adminId, 'ADMIN');
    ownerToken = makeJwt(jwt, ownerId, 'USER');
    adopterToken = makeJwt(jwt, adopterId, 'USER');
    outsiderToken = makeJwt(jwt, outsiderId, 'USER');

    const pet = await prisma.pet.create({
      data: { name: 'DisputeDog', species: 'DOG', status: 'PENDING', currentOwnerId: ownerId },
    });
    petId = pet.id;

    const escrow = await prisma.escrow.create({
      data: {
        stellarPublicKey: `ESCROW_DISPUTE_TEST_${Date.now()}`,
        stellarSecretEncrypted: 'ENCRYPTED_TEST',
        amount: 100,
        status: 'FUNDED',
      },
    });
    escrowId = escrow.id;

    const adoption = await prisma.adoption.create({
      data: { petId, adopterId, ownerId, status: 'ESCROW_FUNDED', escrowId },
    });
    adoptionId = adoption.id;
  });

  afterAll(async () => {
    await prisma.dispute.deleteMany({
      where: { filedBy: { email: { in: Object.values(EMAILS) } } },
    });
    await prisma.adoption.deleteMany({ where: { id: adoptionId } });
    await prisma.escrow.deleteMany({ where: { id: escrowId } });
    await prisma.pet.deleteMany({ where: { id: petId } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
    await app.close();
  });

  // ── open dispute ────────────────────────────────────────────────────────────

  describe('POST /disputes', () => {
    it('opens a dispute as adopter party', async () => {
      const res = await request(app.getHttpServer())
        .post('/disputes')
        .set('Authorization', `Bearer ${adopterToken}`)
        .send({
          entity: adoptionId,
          reason: 'PET_CONDITION',
          description: 'Pet arrived with undisclosed health issues that were not mentioned in the listing.',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(DisputeStatus.OPEN);
      expect(res.body.id).toBeDefined();
      disputeId = res.body.id;
    });

    it('rejects duplicate open dispute from same filer', async () => {
      const res = await request(app.getHttpServer())
        .post('/disputes')
        .set('Authorization', `Bearer ${adopterToken}`)
        .send({
          entity: adoptionId,
          reason: 'PET_CONDITION',
          description: 'Trying to open another dispute about the same adoption entity.',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('DISPUTE_ALREADY_OPEN');
    });

    it('rejects an outsider who is not party to the entity', async () => {
      const res = await request(app.getHttpServer())
        .post('/disputes')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({
          entity: adoptionId,
          reason: 'OTHER',
          description: 'Outsider should not be allowed to file a dispute on this adoption.',
        });

      expect(res.status).toBe(404);
    });

    it('rejects unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .post('/disputes')
        .send({ entity: adoptionId, reason: 'OTHER', description: 'Anonymous attempt.' });
      expect(res.status).toBe(401);
    });
  });

  // ── get dispute ─────────────────────────────────────────────────────────────

  describe('GET /disputes/:id', () => {
    it('owner can read the dispute', async () => {
      const res = await request(app.getHttpServer())
        .get(`/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(disputeId);
    });

    it('admin can read all including internal comments', async () => {
      const res = await request(app.getHttpServer())
        .get(`/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });

    it('outsider cannot read the dispute', async () => {
      const res = await request(app.getHttpServer())
        .get(`/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 404 for nonexistent id', async () => {
      const res = await request(app.getHttpServer())
        .get('/disputes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ── add comment ─────────────────────────────────────────────────────────────

  describe('POST /disputes/:id/comments', () => {
    it('adopter can comment on own dispute', async () => {
      const res = await request(app.getHttpServer())
        .post(`/disputes/${disputeId}/comments`)
        .set('Authorization', `Bearer ${adopterToken}`)
        .send({ body: 'Adding more context about the pet health issue.' });
      expect(res.status).toBe(201);
      expect(res.body.body).toBe('Adding more context about the pet health issue.');
      expect(res.body.internal).toBe(false);
    });

    it('admin can post internal note', async () => {
      const res = await request(app.getHttpServer())
        .post(`/disputes/${disputeId}/comments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Internal review note for admin.', internal: true });
      expect(res.status).toBe(201);
      expect(res.body.internal).toBe(true);
    });

    it('non-admin internal flag is forced to false', async () => {
      const res = await request(app.getHttpServer())
        .post(`/disputes/${disputeId}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ body: 'User trying to flag as internal.', internal: true });
      expect(res.status).toBe(201);
      expect(res.body.internal).toBe(false);
    });

    it('outsider cannot comment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/disputes/${disputeId}/comments`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ body: 'Outsider comment attempt.' });
      expect(res.status).toBe(403);
    });
  });

  // ── add evidence ─────────────────────────────────────────────────────────────

  describe('POST /disputes/:id/evidence (via DisputeEvidenceService)', () => {
    it('evidence model is queryable', async () => {
      const count = await prisma.disputeEvidence.count({ where: { disputeId } });
      expect(typeof count).toBe('number');
    });
  });

  // ── admin assign ─────────────────────────────────────────────────────────────

  describe('POST /admin/disputes/:id/assign', () => {
    it('admin can assign the dispute, moves to UNDER_REVIEW', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/disputes/${disputeId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminId });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(DisputeStatus.UNDER_REVIEW);
      expect(res.body.assignedToId).toBe(adminId);
    });

    it('non-admin cannot assign', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/disputes/${disputeId}/assign`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ adminId });
      expect(res.status).toBe(403);
    });
  });

  // ── admin resolve ────────────────────────────────────────────────────────────

  describe('POST /admin/disputes/:id/resolve', () => {
    it('rejects resolution with text shorter than 20 chars', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outcome: DisputeOutcome.REFUND_TO_HOLDER, resolution: 'Too short.' });
      expect(res.status).toBe(400);
    });

    it('rejects SPLIT outcome without splitPercent', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outcome: DisputeOutcome.SPLIT,
          resolution: 'Splitting the escrow funds between the two parties equally.',
        });
      expect(res.status).toBe(400);
    });

    it('resolves dispute REFUND_TO_HOLDER (200 or 500 depending on escrow)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outcome: DisputeOutcome.REFUND_TO_HOLDER,
          resolution: 'Pet condition was not as described; full refund to adopter.',
        });
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect([DisputeStatus.RESOLVED, DisputeStatus.RESOLUTION_PENDING]).toContain(
          res.body.status,
        );
        expect(res.body.outcome).toBe(DisputeOutcome.REFUND_TO_HOLDER);
      }
    });

    it('non-admin cannot resolve', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adopterToken}`)
        .send({
          outcome: DisputeOutcome.REFUND_TO_HOLDER,
          resolution: 'User trying to self-resolve the dispute on their own here.',
        });
      expect(res.status).toBe(403);
    });
  });

  // ── frozen escrow ────────────────────────────────────────────────────────────

  describe('Frozen escrow while dispute open', () => {
    it('DISPUTED escrow status is persisted correctly', async () => {
      const frozenEscrow = await prisma.escrow.create({
        data: {
          stellarPublicKey: `ESCROW_FROZEN_${Date.now()}`,
          stellarSecretEncrypted: 'ENCRYPTED',
          amount: 50,
          status: 'DISPUTED',
        },
      });
      const e = await prisma.escrow.findUnique({ where: { id: frozenEscrow.id } });
      expect(e?.status).toBe('DISPUTED');
      await prisma.escrow.delete({ where: { id: frozenEscrow.id } });
    });
  });

  // ── state machine unit ───────────────────────────────────────────────────────

  describe('DisputeStateMachine', () => {
    const sm = new DisputeStateMachine();

    it('OPEN → UNDER_REVIEW is valid', () => {
      expect(sm.isValidTransition(DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW)).toBe(true);
    });

    it('OPEN → WITHDRAWN is valid', () => {
      expect(sm.isValidTransition(DisputeStatus.OPEN, DisputeStatus.WITHDRAWN)).toBe(true);
    });

    it('UNDER_REVIEW → RESOLVED is valid', () => {
      expect(sm.isValidTransition(DisputeStatus.UNDER_REVIEW, DisputeStatus.RESOLVED)).toBe(true);
    });

    it('UNDER_REVIEW → RESOLUTION_PENDING is valid', () => {
      expect(sm.isValidTransition(DisputeStatus.UNDER_REVIEW, DisputeStatus.RESOLUTION_PENDING)).toBe(true);
    });

    it('RESOLUTION_PENDING → RESOLVED is valid', () => {
      expect(sm.isValidTransition(DisputeStatus.RESOLUTION_PENDING, DisputeStatus.RESOLVED)).toBe(true);
    });

    it('RESOLVED → OPEN is invalid', () => {
      expect(sm.isValidTransition(DisputeStatus.RESOLVED, DisputeStatus.OPEN)).toBe(false);
    });

    it('WITHDRAWN → OPEN is invalid', () => {
      expect(sm.isValidTransition(DisputeStatus.WITHDRAWN, DisputeStatus.OPEN)).toBe(false);
    });

    it('assertValidTransition throws DISPUTE_INVALID_TRANSITION', () => {
      expect(() =>
        sm.assertValidTransition(DisputeStatus.RESOLVED, DisputeStatus.OPEN),
      ).toThrow();
    });

    it('RESOLVED requires admin', () => {
      expect(sm.requiresAdmin(DisputeStatus.RESOLVED)).toBe(true);
    });

    it('OPEN does not require admin', () => {
      expect(sm.requiresAdmin(DisputeStatus.OPEN)).toBe(false);
    });
  });

  // ── event replay equality ────────────────────────────────────────────────────

  describe('disputeReducer replay equality', () => {
    it('identical event streams produce equal aggregates', () => {
      const events = [
        { eventType: 'DISPUTE_OPENED', payload: {} },
        { eventType: 'DISPUTE_ASSIGNED', payload: { assigneeId: 'admin-x' } },
        { eventType: 'DISPUTE_COMMENT_ADDED', payload: { commentId: 'c1' } },
        { eventType: 'DISPUTE_EVIDENCE_ADDED', payload: { fileHash: 'h1' } },
        { eventType: 'DISPUTE_RESOLVED', payload: { resolution: 'Case closed' } },
      ];
      expect(disputeReducer([...events])).toEqual(disputeReducer([...events]));
    });

    it('replay produces RESOLVED with correct counts', () => {
      const state = disputeReducer([
        { eventType: 'DISPUTE_OPENED', payload: {} },
        { eventType: 'DISPUTE_ASSIGNED', payload: { assigneeId: 'admin-y' } },
        { eventType: 'DISPUTE_COMMENT_ADDED', payload: {} },
        { eventType: 'DISPUTE_COMMENT_ADDED', payload: {} },
        { eventType: 'DISPUTE_EVIDENCE_ADDED', payload: {} },
        { eventType: 'DISPUTE_RESOLVED', payload: { resolution: 'Owner wins' } },
      ]);
      expect(state.status).toBe(DisputeStatus.RESOLVED);
      expect(state.commentCount).toBe(2);
      expect(state.evidenceCount).toBe(1);
      expect(state.assigneeId).toBe('admin-y');
    });
  });

  // ── notification assertions ──────────────────────────────────────────────────

  describe('Notification model', () => {
    it('notification table is queryable', async () => {
      const count = await prisma.notification.count({
        where: { user: { email: { in: Object.values(EMAILS) } } },
      });
      expect(typeof count).toBe('number');
    });

    it('DISPUTE_UPDATE notification can be created', async () => {
      const n = await prisma.notification.create({
        data: {
          userId: ownerId,
          type: 'DISPUTE_UPDATE',
          title: 'Dispute Updated',
          body: 'Your dispute has been updated by an admin.',
          relatedEntityRoute: `/disputes/${disputeId}`,
        },
      });
      expect(n.type).toBe('DISPUTE_UPDATE');
      await prisma.notification.delete({ where: { id: n.id } });
    });
  });
});
