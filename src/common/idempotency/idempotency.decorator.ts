import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'IDEMPOTENT';

/** Mark a POST handler as idempotency-aware.
 *
 * The `IdempotencyInterceptor` reads this metadata and enforces
 * the `Idempotency-Key` header contract for the decorated route.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
