import { createHmac } from 'node:crypto';
import { FakePaymentProvider } from './fake-payment.provider';
import { CreateCheckoutInput, RefundInput } from './payment-provider';

const secret = 'fake-webhook-secret-for-tests';
const checkoutInput: CreateCheckoutInput = {
  amountCents: 1200,
  currency: 'usd',
  successUrl: 'https://example.test/success',
  cancelUrl: 'https://example.test/cancel',
  idempotencyKey: 'checkout-1',
};

function provider(): FakePaymentProvider {
  return new FakePaymentProvider({ environment: 'test', webhookSecret: secret });
}

describe('FakePaymentProvider', () => {
  it('refuses production environments and invalid configuration', () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => provider()).toThrow('disabled');
      process.env.NODE_ENV = 'test';
      expect(() =>
        new FakePaymentProvider({ environment: 'production' as 'test', webhookSecret: secret }),
      ).toThrow('disabled');
      expect(() =>
        new FakePaymentProvider({ environment: 'test', webhookSecret: 'short' }),
      ).toThrow('secret');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('completes checkout and partial refunds with idempotent commands and webhook replay', async () => {
    const fake = provider();
    const created = await fake.createCheckout(checkoutInput);
    expect(created).toEqual({
      checkoutReference: 'fake_cs_000001',
      paymentReference: null,
      amountCents: 1200,
      currency: 'usd',
      status: 'open',
      checkoutUrl: 'https://fake-checkout.invalid/session/fake_cs_000001',
    });
    expect(await fake.createCheckout(checkoutInput)).toEqual(created);
    expect(await fake.getStatus({ checkoutReference: created.checkoutReference })).toMatchObject({
      status: 'open',
    });

    const completed = fake.completeCheckout(created.checkoutReference);
    const event = fake.verifyWebhook(completed);
    expect(event).toEqual({
      id: 'fake_evt_000001',
      type: 'checkout.status_changed',
      checkout: {
        checkoutReference: created.checkoutReference,
        paymentReference: 'fake_pi_000001',
        amountCents: 1200,
        currency: 'usd',
        status: 'paid',
      },
    });
    expect(fake.completeCheckout(created.checkoutReference)).toEqual(completed);
    expect(fake.verifyWebhook(completed)).toEqual(event);
    expect(await fake.createCheckout(checkoutInput)).toEqual(created);
    expect(await fake.getStatus({ checkoutReference: created.checkoutReference })).toMatchObject({
      status: 'paid',
      paymentReference: 'fake_pi_000001',
    });

    const refundInput: RefundInput = {
      paymentReference: 'fake_pi_000001',
      amountCents: 500,
      currency: 'usd',
      idempotencyKey: 'refund-1',
    };
    const refund = await fake.refund(refundInput);
    expect(refund).toEqual({
      refundReference: 'fake_re_000001',
      paymentReference: 'fake_pi_000001',
      amountCents: 500,
      currency: 'usd',
      status: 'pending',
    });
    expect(await fake.refund(refundInput)).toEqual(refund);
    const refunded = fake.completeRefund(refund.refundReference);
    expect(fake.verifyWebhook(refunded)).toEqual({
      id: 'fake_evt_000002',
      type: 'refund.status_changed',
      refund: { ...refund, status: 'succeeded' },
    });
    expect(fake.completeRefund(refund.refundReference)).toEqual(refunded);
    expect(await fake.refund(refundInput)).toEqual(refund);

    const remaining = await fake.refund({ ...refundInput, amountCents: 700, idempotencyKey: 'refund-2' });
    expect(remaining.refundReference).toBe('fake_re_000002');
    await expect(
      fake.refund({ ...refundInput, amountCents: 1, idempotencyKey: 'refund-3' }),
    ).rejects.toThrow('exceeds');
    expect((await fake.getStatus({ checkoutReference: created.checkoutReference })).status).toBe('paid');
  });

  it('rejects idempotency conflicts and never lets callers mutate stored state', async () => {
    const fake = provider();
    const result = await fake.createCheckout(checkoutInput);
    result.status = 'paid';
    expect((await fake.createCheckout(checkoutInput)).status).toBe('open');
    await expect(fake.createCheckout({ ...checkoutInput, amountCents: 1500 })).rejects.toThrow('Idempotency');
    await expect(
      fake.refund({ paymentReference: 'fake_pi_1', amountCents: 1, currency: 'usd', idempotencyKey: 'checkout-1' }),
    ).rejects.toThrow('Idempotency');
    await expect(
      fake.refund({ paymentReference: 'fake_pi_1', amountCents: 1, currency: 'usd', idempotencyKey: 'refund-1' }),
    ).rejects.toThrow('Paid payment not found');
    const checkout = await fake.getStatus({ checkoutReference: result.checkoutReference });
    checkout.status = 'paid';
    expect((await fake.getStatus({ checkoutReference: result.checkoutReference })).status).toBe('open');
    expect(() => fake.completeCheckout('fake_cs_unknown')).toThrow('not found');
    expect(() => fake.completeRefund('fake_re_unknown')).toThrow('not found');
  });

  it.each([
    { amountCents: 0 },
    { amountCents: 49 },
    { amountCents: 50.5 },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { amountCents: NaN },
    { currency: 'eur' },
    { idempotencyKey: '' },
    { idempotencyKey: 'a'.repeat(256) },
    { idempotencyKey: 'bad key' },
    { successUrl: 'http://example.test/success' },
    { cancelUrl: 'https://user:pass@example.test' },
    { cancelUrl: 'https://example.test/\r\nInjected' },
  ])('rejects invalid checkout input %p', async (override) => {
    await expect(provider().createCheckout({ ...checkoutInput, ...override } as CreateCheckoutInput)).rejects.toThrow();
  });

  it('rejects invalid refund and status input before lookup', async () => {
    const fake = provider();
    const input: RefundInput = { paymentReference: 'fake_pi_1', amountCents: 1, currency: 'usd', idempotencyKey: 'refund' };
    for (const override of [
      { amountCents: 0 },
      { amountCents: -1 },
      { amountCents: 1.5 },
      { amountCents: 100_000_000 },
      { currency: 'eur' },
      { idempotencyKey: '' },
      { paymentReference: 'bad ref' },
    ]) {
      await expect(fake.refund({ ...input, ...override } as RefundInput)).rejects.toThrow();
    }
    await expect(fake.getStatus({ checkoutReference: '' })).rejects.toThrow();
  });

  it('checks raw bytes, signature and event shape without trusting signed extra fields', async () => {
    const fake = provider();
    const checkout = await fake.createCheckout(checkoutInput);
    const signed = fake.completeCheckout(checkout.checkoutReference);
    expect(() => fake.verifyWebhook({ ...signed, payload: Buffer.from(`${signed.payload} `) })).toThrow('signature');
    expect(() => fake.verifyWebhook({ ...signed, signature: 'fake-v1=' + '0'.repeat(64) })).toThrow('signature');
    expect(() => fake.verifyWebhook({ ...signed, signature: 'bad' })).toThrow('signature');
    expect(() => fake.verifyWebhook({ ...signed, payload: {} as Buffer })).toThrow('raw bytes');

    const payload = Buffer.from(JSON.stringify({ id: 'fake_evt_9', type: 'checkout.status_changed', checkout: { status: 'paid' } }));
    const signature = `fake-v1=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(() => fake.verifyWebhook({ payload, signature })).toThrow();
  });
});
