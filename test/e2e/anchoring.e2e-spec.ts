import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventLedgerService } from '../../src/event-ledger/event-ledger.service';
import { AnchorBatchRepository } from '../../src/anchoring/anchor-batch.repository';
import { AnchoringService } from '../../src/anchoring/anchoring.service';
import { AnchorConfirmationProcessor } from '../../src/anchoring/anchor-confirmation.processor';
import { FakeAnchorGateway } from '../../src/anchoring/gateways/fake-anchor.gateway';
import { hashLedgerEvent } from '../../src/anchoring/merkle';
import { EventEntityType } from '@prisma/client';

describe('Anchoring end-to-end (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: EventLedgerService;
  let repository: AnchorBatchRepository;
  let anchoring: AnchoringService;
  let processor: AnchorConfirmationProcessor;
  let gateway: FakeAnchorGateway;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    ledger = moduleFixture.get(EventLedgerService);
    repository = moduleFixture.get(AnchorBatchRepository);
    anchoring = moduleFixture.get(AnchoringService);
    processor = moduleFixture.get(AnchorConfirmationProcessor);
    gateway = moduleFixture.get(FakeAnchorGateway);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('appends, batches, anchors, confirms and verifies an event', async () => {
    const aggregateId = `anchor-e2e-${Date.now()}`;

    const first = await ledger.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId,
      eventType: 'PET_REGISTERED',
      payload: { name: 'Buddy', secret: 'not-public' },
    });
    const second = await ledger.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId,
      eventType: 'PET_LISTED',
      payload: { city: 'Lagos' },
    });

    // The open batch may contain events from other tests; address this
    // aggregate's batch explicitly.
    const firstLeaf = await repository.findByEventLogId(first.id);
    const secondLeaf = await repository.findByEventLogId(second.id);
    expect(firstLeaf).not.toBeNull();
    expect(secondLeaf).not.toBeNull();
    expect(firstLeaf?.batchId).toBe(secondLeaf?.batchId);

    const batchId = firstLeaf!.batchId;
    await anchoring.submitBatch(batchId);

    const confirmation = await processor.process(batchId);
    expect(confirmation.status).toBe('CONFIRMED');
    expect(confirmation.txHash).toBeTruthy();
    expect(confirmation.blockHeight).toEqual(expect.any(Number));

    const events = await prisma.eventLog.findMany({
      where: { id: { in: [first.id, second.id] } },
    });
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.txHash).toBe(confirmation.txHash);
      expect(event.blockHeight).toBe(confirmation.blockHeight);
    }

    const proof = await anchoring.getProof(hashLedgerEvent(first));
    expect(proof.merkleRoot).toMatch(/^[a-f0-9]{64}$/);

    const response = await request(app.getHttpServer())
      .post('/verify/proof')
      .send({
        eventHash: proof.eventHash,
        proof: proof.proof,
        merkleRoot: proof.merkleRoot,
        txHash: proof.txHash,
      })
      .expect(200);

    expect(response.body).toEqual({
      valid: true,
      anchoredAt: expect.any(String) as string,
      txHash: proof.txHash,
      explorerUrl: expect.stringContaining(proof.txHash as string),
    });
    expect(JSON.stringify(response.body)).not.toContain('Buddy');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('returns valid=false for a tampered proof without leaking payload data', async () => {
    const aggregateId = `anchor-tamper-${Date.now()}`;
    const event = await ledger.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId,
      eventType: 'PET_REGISTERED',
      payload: { name: 'Tamper', privateNote: 'do-not-leak' },
    });
    // A second event guarantees a non-empty Merkle path to tamper with.
    await ledger.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId,
      eventType: 'PET_LISTED',
      payload: { city: 'Abuja' },
    });

    const leaf = await repository.findByEventLogId(event.id);
    await anchoring.submitBatch(leaf!.batchId);
    await processor.process(leaf!.batchId);

    const proof = await anchoring.getProof(hashLedgerEvent(event));
    expect(proof.proof.length).toBeGreaterThan(0);
    const tamperedProof = proof.proof.map((step, index) =>
      index === 0 ? { ...step, hash: 'f'.repeat(64) } : step,
    );

    const response = await request(app.getHttpServer())
      .post('/verify/proof')
      .send({
        eventHash: proof.eventHash,
        proof: tamperedProof,
        merkleRoot: proof.merkleRoot,
        txHash: proof.txHash,
      })
      .expect(200);

    expect(response.body.valid).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('do-not-leak');
    expect(response.body).not.toHaveProperty('payload');
    expect(response.body).not.toHaveProperty('event');
  });

  it('flags a chain root mismatch as DISPUTED and emits a critical alert', async () => {
    const aggregateId = `anchor-dispute-${Date.now()}`;
    const event = await ledger.appendEvent({
      aggregateType: EventEntityType.PET,
      aggregateId,
      eventType: 'PET_REGISTERED',
      payload: { name: 'Disputed' },
    });

    const leaf = await repository.findByEventLogId(event.id);
    const submitted = await anchoring.submitBatch(leaf!.batchId);

    gateway.tamperRoot(submitted!.txHash!, 'f'.repeat(64));
    const confirmation = await processor.process(leaf!.batchId);

    expect(confirmation.status).toBe('DISPUTED');

    const batch = await prisma.anchorBatch.findUnique({
      where: { id: leaf!.batchId },
    });
    expect(batch?.status).toBe('DISPUTED');
  });
});
