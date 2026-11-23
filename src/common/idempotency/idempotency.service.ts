import {
  Injectable,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** Idempotency key TTL: 24 hours */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashBody(body: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(body ?? null))
      .digest('hex');
  }

  /**
   * Check whether a key has already been used for this user + route.
   *
   * Returns:
   * - `null`           → first use; caller should proceed normally.
   * - `StoredResponse` → replay the previously stored response.
   *
   * Throws:
   * - `409 ConflictException`              → key is IN_FLIGHT (another request in progress).
   * - `422 UnprocessableEntityException`   → same key, different body.
   */
  async check(
    key: string,
    userId: string,
    route: string,
    requestHash: string,
  ): Promise<StoredResponse | null> {
    const existing = await this.prisma.idempotencyKey.findFirst({
      where: { key, userId, route },
    });

    if (!existing) return null;

    if (existing.status === 'IN_FLIGHT') {
      throw new ConflictException(
        'A request with this Idempotency-Key is already in flight. Wait and retry.',
      );
    }

    if (existing.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        'Idempotency-Key reused with a different request body.',
      );
    }

    return {
      statusCode: existing.statusCode ?? 200,
      body: existing.responseBody,
    };
  }

  /** Reserve the key so concurrent duplicates get a 409. */
  async reserve(
    key: string,
    userId: string,
    route: string,
    requestHash: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + KEY_TTL_MS);
    await this.prisma.idempotencyKey.create({
      data: { key, userId, route, requestHash, status: 'IN_FLIGHT', expiresAt },
    });
  }

  /** Store the response and mark the key COMPLETED. */
  async complete(
    key: string,
    userId: string,
    route: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyKey.updateMany({
      where: { key, userId, route },
      data: {
        status: 'COMPLETED',
        statusCode,
        responseBody: body as any,
      },
    });
  }

  /** Release the key reservation on error so callers can retry. */
  async release(key: string, userId: string, route: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: { key, userId, route, status: 'IN_FLIGHT' },
    });
  }
}
