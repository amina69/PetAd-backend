import { GoneException, UnauthorizedException } from '@nestjs/common';
import { ReceiptSigningService } from './receipt-signing.service';

describe('ReceiptSigningService', () => {
  const createService = (
    options: {
      ttl?: number;
      signingSecret?: string;
      jwtSecret?: string;
    } = {},
  ) =>
    new ReceiptSigningService({
      get: <T>(key: string, fallback?: T): T | undefined => {
        if (key === 'payments.receiptUrlTtlSeconds') {
          return (options.ttl ?? 300) as unknown as T;
        }
        if (key === 'payments.receiptSigningSecret') {
          return options.signingSecret as unknown as T;
        }
        if (key === 'jwtSecret') {
          return (options.jwtSecret ??
            'test-jwt-secret-at-least-32-characters') as unknown as T;
        }
        return fallback;
      },
    } as never);

  it('round-trips a valid token', () => {
    const service = createService();
    const { token, expiresAt } = service.sign('payment-1', 7n);
    const payload = service.verify(token);

    expect(payload.paymentId).toBe('payment-1');
    expect(payload.receiptNumber).toBe(7n);
    expect(
      Math.abs(payload.expiresAt.getTime() - expiresAt.getTime()),
    ).toBeLessThan(1000);
  });

  it('rejects tampered signatures and malformed tokens', () => {
    const service = createService();
    const { token } = service.sign('payment-1', 7n);
    const [payload] = token.split('.');

    expect(() => service.verify(`${payload}.deadbeef`)).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verify('not-a-token')).toThrow(UnauthorizedException);
    expect(() => service.verify('a.b.c')).toThrow(UnauthorizedException);
    expect(() =>
      service.verify(Buffer.from('{"pid":1}').toString('base64url') + '.sig'),
    ).toThrow(UnauthorizedException);
  });

  it('rejects tokens signed with a different secret', () => {
    const signer = createService({ signingSecret: 'x'.repeat(32) });
    const verifier = createService({ signingSecret: 'y'.repeat(32) });
    const { token } = signer.sign('payment-1', 1n);

    expect(() => verifier.verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects expired tokens', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    const service = createService({ ttl: 30 });
    const { token } = service.sign('payment-1', 1n);

    dateSpy.mockReturnValue(now.getTime() + 31_000);
    expect(() => service.verify(token)).toThrow(GoneException);

    dateSpy.mockRestore();
  });

  it('requires a configured secret', () => {
    const service = createService({
      signingSecret: undefined,
      jwtSecret: undefined,
    });
    // jwtSecret fallback in the mock returns a default, so build one that does not.
    const withoutSecret = new ReceiptSigningService({
      get: () => undefined,
    } as never);

    expect(() => withoutSecret.sign('payment-1', 1n)).toThrow(
      /secret is not configured/,
    );
    expect(service).toBeDefined();
  });
});
