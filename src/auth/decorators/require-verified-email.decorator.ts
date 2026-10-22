import { UseGuards } from '@nestjs/common';
import { RequireVerifiedEmailGuard } from '../guards/require-verified-email.guard';

/**
 * Gates a route behind a verified email address.
 *
 * Must be combined with an authentication guard (e.g. JwtAuthGuard).
 * Unverified users receive 403 with code `EMAIL_NOT_VERIFIED`.
 */
export const RequireVerifiedEmail = () => UseGuards(RequireVerifiedEmailGuard);
