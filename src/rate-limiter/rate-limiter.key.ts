import { ExecutionContext, Request } from '@nestjs/common';

/**
 * Generates a rate limit key for the NestJS throttler.
 * - Authenticated users: key is 'user:{userId}'
 * - Unauthenticated users: key is 'ip:{remoteAddress}'
 *
 * This enables per-user rate limiting for authenticated requests
 * while maintaining per-IP rate limiting for unauthenticated requests.
 * The key is shared across application instances when using Redis storage.
 *
 * NestJS ThrottlerGenerateKeyFunction signature:
 * (context: ExecutionContext, trackerString: string, throttlerName: string) => string
 */
export function generateKey(
  context: ExecutionContext,
  _trackerString: string,
  _throttlerName: string,
): string {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request) {
    return 'ip:unknown';
  }

  // Check if user is authenticated (JWT strategy populates req.user)
  const user = (request as any).user;

  if (user && user.id) {
    // Authenticated user - use user ID for per-user rate limiting
    return `user:${user.id}`;
  }

  // Unauthenticated user - use IP address for per-IP rate limiting
  const ip =
    (request as any).ip ||
    (request as any).socket?.remoteAddress ||
    'unknown';

  return `ip:${ip}`;
}