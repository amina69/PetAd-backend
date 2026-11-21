import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { WebhookSignatureService } from './webhook-signature.service';

const SECRET = 'whsec_test_secret';
const BODY = Buffer.from('{"id":"evt_1","type":"payment.succeeded"}');

function sign(secret: string, timestamp: number, body: Buffer): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('WebhookSignatureService', () => {
  let service: WebhookSignatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSignatureService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'webhooks.providers') {
                return {
                  stripe: {
                    secret: SECRET,
                    signatureHeader: 'stripe-signature',
                    eventIdHeader: 'stripe-event-id',
                  },
                };
              }
              if (key === 'webhooks.toleranceSeconds') return 300;
              return undefined;
            }),
          },
        },
      ],
    }).compile();
    service = module.get(WebhookSignatureService);
  });

  const headers = (signature: string) => ({
    'stripe-signature': signature,
    'stripe-event-id': 'evt_1',
    'x-webhook-event-type': 'payment.succeeded',
  });

  it('accepts a correctly signed webhook', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const verified = service.verify('stripe', BODY, headers(sign(SECRET, timestamp, BODY)));

    expect(verified.eventId).toBe('evt_1');
    expect(verified.eventType).toBe('payment.succeeded');
  });

  it('rejects a tampered body', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(SECRET, timestamp, BODY);

    expect(() =>
      service.verify('stripe', Buffer.from('{"id":"evt_1","amount":999999}'), headers(signature)),
    ).toThrow(BadRequestException);
  });

  it('rejects a replayed webhook outside the timestamp tolerance', () => {
    const timestamp = Math.floor(Date.now() / 1000) - 3600;

    expect(() =>
      service.verify('stripe', BODY, headers(sign(SECRET, timestamp, BODY))),
    ).toThrow(/replay window/i);
  });

  it('rejects an unknown provider or a signature from another secret', () => {
    const timestamp = Math.floor(Date.now() / 1000);

    expect(() =>
      service.verify('unknown', BODY, headers(sign(SECRET, timestamp, BODY))),
    ).toThrow(/unknown webhook provider/i);
    expect(() =>
      service.verify('stripe', BODY, headers(sign('other-secret', timestamp, BODY))),
    ).toThrow(/invalid webhook signature/i);
  });
});
