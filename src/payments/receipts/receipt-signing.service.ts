import {
  GoneException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export interface ReceiptTokenPayload {
  paymentId: string;
  receiptNumber: bigint;
  expiresAt: Date;
}

/**
 * Signs and verifies short-lived receipt download URLs.
 *
 * The token is `base64url(payload).base64url(HMAC-SHA256(payload))`. It binds
 * the download to a specific payment and receipt number, and expires after
 * `PAYMENTS_RECEIPT_URL_TTL_SECONDS`.
 */
@Injectable()
export class ReceiptSigningService {
  constructor(private readonly config: ConfigService) {}

  sign(
    paymentId: string,
    receiptNumber: bigint,
  ): { token: string; expiresAt: Date } {
    const ttlSeconds = this.config.get<number>(
      'payments.receiptUrlTtlSeconds',
      300,
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const payload = Buffer.from(
      JSON.stringify({
        pid: paymentId,
        rn: receiptNumber.toString(),
        exp: Math.floor(expiresAt.getTime() / 1000),
      }),
    ).toString('base64url');

    return {
      token: `${payload}.${this.hmac(payload)}`,
      expiresAt,
    };
  }

  verify(token: string): ReceiptTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnauthorizedException('Invalid receipt link');
    }

    const [payload, signature] = parts;
    const expected = this.hmac(payload);

    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid receipt link');
    }

    let parsed: { pid?: unknown; rn?: unknown; exp?: unknown };
    try {
      parsed = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as typeof parsed;
    } catch {
      throw new UnauthorizedException('Invalid receipt link');
    }

    if (
      typeof parsed.pid !== 'string' ||
      typeof parsed.rn !== 'string' ||
      !/^\d+$/.test(parsed.rn) ||
      typeof parsed.exp !== 'number'
    ) {
      throw new UnauthorizedException('Invalid receipt link');
    }

    const expiresAt = new Date(parsed.exp * 1000);
    if (expiresAt.getTime() <= Date.now()) {
      throw new GoneException('Receipt link has expired');
    }

    return {
      paymentId: parsed.pid,
      receiptNumber: BigInt(parsed.rn),
      expiresAt,
    };
  }

  private hmac(payload: string): string {
    const secret =
      this.config.get<string>('payments.receiptSigningSecret') ??
      this.config.get<string>('jwtSecret');

    if (!secret) {
      throw new Error('Receipt signing secret is not configured');
    }

    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
}
