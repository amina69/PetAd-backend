import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

interface ProviderConfig {
  secret: string;
  signatureHeader: string;
  eventIdHeader: string;
}

export interface VerifiedWebhook {
  eventId: string;
  eventType: string | null;
  timestamp: number;
}

interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

function header(
  headers: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = headers[name.toLowerCase()];
    if (typeof value === 'string' && value.length > 0) return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return undefined;
}

@Injectable()
export class WebhookSignatureService {
  private readonly providers: Record<string, ProviderConfig>;
  private readonly toleranceSeconds: number;

  constructor(configService: ConfigService) {
    this.providers =
      configService.get<Record<string, ProviderConfig>>('webhooks.providers') ??
      {};
    this.toleranceSeconds =
      configService.get<number>('webhooks.toleranceSeconds') ?? 300;
  }

  verify(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, unknown>,
  ): VerifiedWebhook {
    const config = this.providers[provider];
    if (!config) {
      throw new BadRequestException(`Unknown webhook provider: ${provider}`);
    }

    const signature = header(headers, [
      config.signatureHeader,
      'x-webhook-signature',
      'x-signature',
      'stripe-signature',
    ]);
    const eventId = header(headers, [
      config.eventIdHeader,
      'x-webhook-event-id',
      'x-webhook-id',
      'x-idempotency-key',
    ]);

    if (!signature || !eventId) {
      throw new BadRequestException(
        'Missing webhook signature or event id header',
      );
    }
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new BadRequestException('Missing raw webhook body');
    }

    const parsed = this.parseSignature(signature);
    const ageSeconds = Math.abs(Date.now() / 1000 - parsed.timestamp);
    if (!Number.isFinite(ageSeconds) || ageSeconds > this.toleranceSeconds) {
      throw new BadRequestException(
        'Webhook timestamp is outside the allowed replay window',
      );
    }

    // HMAC over the exact raw bytes with the provider-specific secret.
    const expected = createHmac('sha256', config.secret)
      .update(`${parsed.timestamp}.`)
      .update(rawBody)
      .digest();

    const isValid = parsed.signatures.some((candidate) => {
      const supplied = Buffer.from(candidate, 'hex');
      return (
        supplied.length === expected.length && timingSafeEqual(supplied, expected)
      );
    });
    if (!isValid) {
      throw new BadRequestException('Invalid webhook signature');
    }

    return {
      eventId,
      eventType:
        header(headers, ['x-webhook-event-type', 'x-event-type']) ?? null,
      timestamp: parsed.timestamp,
    };
  }

  private parseSignature(value: string): ParsedSignature {
    const parts: Record<string, string[]> = {};
    for (const part of value.split(',')) {
      const [key, ...rest] = part.trim().split('=');
      if (!key || rest.length === 0) continue;
      parts[key] = [...(parts[key] ?? []), rest.join('=')];
    }

    const timestamp = Number(parts.t?.[0]);
    const signatures = parts.v1 ?? [];
    if (!Number.isInteger(timestamp) || signatures.length === 0) {
      throw new BadRequestException('Malformed webhook signature header');
    }

    return { timestamp, signatures };
  }
}
