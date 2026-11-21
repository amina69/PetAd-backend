import { createHash } from 'crypto';

/** Hash device/IP signals with a server-side salt; raw values are never stored. */
export function hashTrustSignal(
  value: string | undefined | null,
  salt: string,
): string | null {
  if (!value) return null;
  return createHash('sha256')
    .update(salt)
    .update(':')
    .update(value.trim().toLowerCase())
    .digest('hex');
}
