import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/**
 * Marks a route as requiring a verified email address. Must be paired with
 * `RequireVerifiedEmailGuard` (and `JwtAuthGuard`, which populates the user).
 */
export const RequireVerifiedEmail = () =>
  SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
