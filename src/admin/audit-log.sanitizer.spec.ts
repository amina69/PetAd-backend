import { sanitiseAuditMetadata } from './audit-log.sanitizer';

describe('sanitiseAuditMetadata', () => {
  it('redacts secrets by key name at any depth', () => {
    const result = sanitiseAuditMetadata({
      password: 'hunter2',
      nested: {
        apiKey: 'sk_live_123',
        Authorization: 'Bearer xyz',
        safe: 'keep me',
      },
      items: [
        { refreshToken: 'abc', pin: '1234', cardNumber: '4111111111111111' },
      ],
    });

    expect(result).toEqual({
      password: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        Authorization: '[REDACTED]',
        safe: 'keep me',
      },
      items: [
        {
          refreshToken: '[REDACTED]',
          pin: '[REDACTED]',
          cardNumber: '[REDACTED]',
        },
      ],
    });
  });

  it('redacts secret-shaped values even under innocuous keys', () => {
    const bcrypt = `$2b$12$${'a'.repeat(53)}`;
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';

    const result = sanitiseAuditMetadata({
      note: bcrypt,
      other: jwt,
      argon: '$argon2id$v=19$m=65536,t=3,p=4$abc',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
      bearer: 'Bearer abc.def',
      plain: 'this is fine',
    }) as Record<string, string>;

    expect(result.note).toBe('[REDACTED]');
    expect(result.other).toBe('[REDACTED]');
    expect(result.argon).toBe('[REDACTED]');
    expect(result.pem).toBe('[REDACTED]');
    expect(result.bearer).toBe('[REDACTED]');
    expect(result.plain).toBe('this is fine');
  });

  it('never leaks a password hash canary', () => {
    const canary = `$2a$10$${'B'.repeat(53)}`;
    const json = JSON.stringify(
      sanitiseAuditMetadata({
        metadata: { note: canary, deep: [{ value: canary }] },
      }),
    );

    expect(json).not.toContain(canary);
    expect(json.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it('converts values into JSON-safe primitives', () => {
    const result = sanitiseAuditMetadata({
      big: 9007199254740993n,
      date: new Date('2026-01-02T03:04:05.000Z'),
      infinite: Number.POSITIVE_INFINITY,
      nan: Number.NaN,
      missing: undefined,
      flag: true,
      count: 3,
    });

    expect(result).toEqual({
      big: '9007199254740993',
      date: '2026-01-02T03:04:05.000Z',
      infinite: null,
      nan: null,
      missing: null,
      flag: true,
      count: 3,
    });
  });

  it('cuts cycles', () => {
    const value: Record<string, unknown> = { name: 'root' };
    value.self = value;

    const result = sanitiseAuditMetadata(value) as Record<string, unknown>;

    expect(result.name).toBe('root');
    expect(result.self).toBe('[CYCLE]');
  });

  it('truncates deeply nested structures', () => {
    let value: Record<string, unknown> = { leaf: 'x' };
    for (let index = 0; index < 10; index += 1) {
      value = { next: value };
    }

    const json = JSON.stringify(sanitiseAuditMetadata(value));
    expect(json).toContain('[TRUNCATED]');
  });

  it('truncates very long strings', () => {
    const result = sanitiseAuditMetadata('a'.repeat(5000)) as string;

    expect(result.length).toBeLessThan(4100);
    expect(result.endsWith('…[truncated]')).toBe(true);
  });

  it('redacts unsupported types such as functions and symbols', () => {
    expect(sanitiseAuditMetadata(() => undefined)).toBe('[REDACTED]');
    expect(sanitiseAuditMetadata(Symbol('x'))).toBe('[REDACTED]');
  });
});
