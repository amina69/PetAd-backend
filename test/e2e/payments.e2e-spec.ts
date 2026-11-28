import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Stream } from 'stream';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

interface BinaryResponse {
  status: number;
  body: Buffer;
}

function binaryParser(
  res: Stream,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Payments, receipts and refunds (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    process.env.PAYMENTS_RECEIPT_DIR =
      process.env.PAYMENTS_RECEIPT_DIR ?? `/tmp/petad-e2e-receipts`;

    const moduleFixture = await Test.createTestingModule({
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
    app.useGlobalFilters(app.get(HttpExceptionFilter));
    prisma = app.get(PrismaService);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function register(
    label: string,
  ): Promise<{ token: string; userId: string }> {
    const email = `pay_${label}_${suffix}@example.com`;
    const response = await request(server)
      .post('/auth/register')
      .send({
        email,
        password: 'StrongPass123',
        firstName: 'Pay',
        lastName: label,
      })
      .expect(201);

    return {
      token: response.body.access_token as string,
      userId: response.body.user.id as string,
    };
  }

  async function createEscrow(): Promise<string> {
    const escrow = await prisma.escrow.create({
      data: {
        stellarPublicKey: `G${suffix}${Math.random().toString(36).slice(2, 10)}`,
        stellarSecretEncrypted: 'encrypted-test-secret',
        amount: 100,
      },
    });
    return escrow.id;
  }

  async function quote(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await request(server)
      .post('/payments/quote')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);

    expect(response.body.feeRateBps).toBe(250);
    return response.body.id as string;
  }

  async function createPayment(
    token: string,
    quoteId: string,
  ): Promise<string> {
    const response = await request(server)
      .post('/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId })
      .expect(201);

    expect(response.body.status).toBe('PENDING');
    return response.body.id as string;
  }

  async function createPendingPayment(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    return createPayment(token, await quote(token, body));
  }

  async function download(url: string): Promise<BinaryResponse> {
    const path = url.replace(/^\/api\/v1/, '');
    const response = await request(server)
      .get(path)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    return {
      status: response.status,
      body: response.body as Buffer,
    };
  }

  it('runs quote → pay → fund escrow → settle → receipt → partial refund', async () => {
    const { token } = await register('owner');
    const escrowId = await createEscrow();

    const quoteId = await quote(token, {
      purpose: 'DEPOSIT',
      amountMinor: '10000000',
      currency: 'XLM',
      escrowId,
    });

    const paymentId = await createPayment(token, quoteId);

    const paid = await request(server)
      .post(`/payments/${paymentId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    expect(paid.body.status).toBe('PAID');
    expect(paid.body.txHash).toMatch(/^fake_stellar_/);
    expect(paid.body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'DEBIT',
          type: 'PRINCIPAL',
          amountMinor: '10000000',
        }),
        expect.objectContaining({
          direction: 'CREDIT',
          type: 'PRINCIPAL',
          amountMinor: '10000000',
        }),
      ]),
    );

    const funded = await prisma.escrow.findUniqueOrThrow({
      where: { id: escrowId },
    });
    expect(funded.status).toBe('FUNDED');
    expect(funded.fundingTxHash).toBe(paid.body.txHash);

    const settled = await request(server)
      .post(`/payments/${paymentId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ penaltyMinor: '1000000' })
      .expect(200);

    expect(settled.body.settlementFeeMinor).toBe('250000');
    expect(settled.body.settlementPenaltyMinor).toBe('1000000');
    expect(settled.body.settlementRefundMinor).toBe('8750000');

    const receiptLink = await request(server)
      .get(`/payments/${paymentId}/receipt`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(receiptLink.body.receiptNumber).toMatch(/^\d+$/);
    expect(receiptLink.body.verificationCode).toMatch(/^[0-9A-F]{16}$/);
    expect(receiptLink.body.url).toContain(
      '/api/v1/payments/receipts/download/',
    );

    const firstDownload = await download(receiptLink.body.url);
    expect(firstDownload.body.subarray(0, 5).toString()).toBe('%PDF-');

    const regenerated = await request(server)
      .get(`/payments/${paymentId}/receipt`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(regenerated.body.receiptNumber).toBe(receiptLink.body.receiptNumber);
    expect(regenerated.body.contentHash).toBe(receiptLink.body.contentHash);

    const secondDownload = await download(regenerated.body.url);
    expect(secondDownload.body.equals(firstDownload.body)).toBe(true);

    const partial = await request(server)
      .post(`/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '4000000', reason: 'partial return' })
      .expect(201);

    expect(partial.body.status).toBe('PARTIALLY_REFUNDED');
    expect(partial.body.refundedAmountMinor).toBe('4000000');
    expect(partial.body.refunds).toHaveLength(1);

    await request(server)
      .post(`/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '4750001' })
      .expect(400);

    const final = await request(server)
      .post(`/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '4750000' })
      .expect(201);

    expect(final.body.refundedAmountMinor).toBe('8750000');
    expect(final.body.status).toBe('PARTIALLY_REFUNDED');

    // The refundable cap is now exhausted, even for a single minor unit.
    await request(server)
      .post(`/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '1' })
      .expect(400);

    const history = await request(server)
      .get(`/payments/${paymentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(history.body.lines.length).toBeGreaterThanOrEqual(8);
    expect(history.body.refunds).toHaveLength(2);
    expect(history.body.receipt.receiptNumber).toBe(
      receiptLink.body.receiptNumber,
    );
  });

  it('marks declined payments FAILED and refuses to pay them twice', async () => {
    const { token } = await register('declined');
    const paymentId = await createPendingPayment(token, {
      purpose: 'TOPUP',
      amountMinor: '5000000',
    });

    const declined = await request(server)
      .post(`/payments/${paymentId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ providerToken: 'decline' })
      .expect(400);

    expect(declined.body.code).toBe('PAYMENT_DECLINED');

    const failed = await request(server)
      .get(`/payments/${paymentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(failed.body.status).toBe('FAILED');

    await request(server)
      .post(`/payments/${paymentId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
  });

  it('rejects invalid quotes, double spends and unrefundable purposes', async () => {
    const { token } = await register('validation');

    await request(server)
      .post('/payments/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'DEPOSIT', amountMinor: '1.5' })
      .expect(400);

    await request(server)
      .post('/payments/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({
        purpose: 'DEPOSIT',
        amountMinor: '10',
        escrowId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        adoptionId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e',
      })
      .expect(400);

    const quoteId = await quote(token, {
      purpose: 'FEE',
      amountMinor: '10000000',
    });
    const paymentId = await createPayment(token, quoteId);

    await request(server)
      .post('/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId })
      .expect(409);

    await request(server)
      .get(`/payments/${paymentId}/receipt`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(server)
      .post(`/payments/${paymentId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    await request(server)
      .post(`/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '100' })
      .expect(400);

    const escrowId = await createEscrow();
    const depositQuote = await quote(token, {
      purpose: 'DEPOSIT',
      amountMinor: '1000000',
      escrowId,
    });
    const depositId = await createPayment(token, depositQuote);
    await request(server)
      .post(`/payments/${depositId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    await request(server)
      .post(`/payments/${depositId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '100' })
      .expect(400);
  });

  it("hides another user's payments behind 404s", async () => {
    const owner = await register('private-owner');
    const stranger = await register('stranger');

    const paymentId = await createPendingPayment(owner.token, {
      purpose: 'TOPUP',
      amountMinor: '2000000',
    });

    await request(server)
      .get(`/payments/${paymentId}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);

    await request(server)
      .post(`/payments/${paymentId}/pay`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({})
      .expect(404);

    await request(server)
      .get(`/payments/${paymentId}/receipt`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);

    await request(server).get(`/payments/${paymentId}`).expect(401);
  });

  it('allocates gap-free sequential receipt numbers under concurrency', async () => {
    const { token } = await register('concurrent');
    const paymentIds: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const paymentId = await createPendingPayment(token, {
        purpose: 'FEE',
        amountMinor: `${1000000 + index}`,
      });
      await request(server)
        .post(`/payments/${paymentId}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
      paymentIds.push(paymentId);
    }

    const responses = await Promise.all(
      paymentIds.map((paymentId) =>
        request(server)
          .get(`/payments/${paymentId}/receipt`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      ),
    );

    const numbers = responses
      .map((response) => BigInt(response.body.receiptNumber as string))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

    expect(new Set(numbers.map(String)).size).toBe(numbers.length);
    for (let index = 1; index < numbers.length; index += 1) {
      expect(numbers[index]).toBe(numbers[index - 1] + 1n);
    }

    const receipts = await prisma.receipt.count({
      where: { paymentId: { in: paymentIds } },
    });
    expect(receipts).toBe(paymentIds.length);
  });
});
