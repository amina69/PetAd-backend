import { FakePaymentProvider } from './fake-payment.provider';

describe('FakePaymentProvider', () => {
  const provider = new FakePaymentProvider();

  it('is deterministic and reports its name', async () => {
    const first = await provider.charge({
      paymentId: 'payment-1',
      amountMinor: 1000n,
      currency: 'XLM',
    });
    const second = await provider.charge({
      paymentId: 'payment-1',
      amountMinor: 1000n,
      currency: 'XLM',
    });

    expect(provider.name).toBe('fake');
    expect(first).toEqual(second);
    expect(first.succeeded).toBe(true);
    expect(first.externalRef).toMatch(/^fake_ch_/);
    expect(first.txHash).toMatch(/^fake_stellar_/);
  });

  it('declines charge and refund when asked', async () => {
    await expect(
      provider.charge({
        paymentId: 'payment-1',
        amountMinor: 1000n,
        currency: 'XLM',
        token: 'decline',
      }),
    ).resolves.toEqual({
      succeeded: false,
      failureReason: 'card_declined',
    });

    await expect(
      provider.refund({
        paymentId: 'payment-1',
        amountMinor: 500n,
        currency: 'XLM',
        token: 'FAIL',
      }),
    ).resolves.toEqual({
      succeeded: false,
      failureReason: 'refund_declined',
    });
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      provider.charge({
        paymentId: 'payment-1',
        amountMinor: 0n,
        currency: 'XLM',
      }),
    ).resolves.toEqual({
      succeeded: false,
      failureReason: 'invalid_amount',
    });

    await expect(
      provider.refund({
        paymentId: 'payment-1',
        amountMinor: 0n,
        currency: 'XLM',
      }),
    ).resolves.toEqual({
      succeeded: false,
      failureReason: 'invalid_amount',
    });
  });

  it('produces deterministic refund references', async () => {
    const input = {
      paymentId: 'payment-1',
      amountMinor: 500n,
      currency: 'XLM',
    };
    const first = await provider.refund(input);
    const second = await provider.refund(input);

    expect(first).toEqual(second);
    expect(first.succeeded).toBe(true);
    expect(first.externalRef).toMatch(/^fake_re_/);
  });
});
