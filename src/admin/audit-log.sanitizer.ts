const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

/**
 * Object keys whose values are always secrets, regardless of content. Matched
 * case-insensitively against the key name.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwd/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /mnemonic/i,
  /seed[-_]?phrase/i,
  /credential/i,
  /card[-_]?number/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bssn\b/i,
  /recovery[-_]?code/i,
  /^otp$/i,
  /^pin$/i,
];

/**
 * Values that look like secrets even when the key is innocuous (e.g. a canary
 * bcrypt hash stored under `note`).
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, // bcrypt
  /^\$argon2(id|i|d)\$/, // argon2
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /^Bearer\s+.+$/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export type SanitisedValue =
  | string
  | number
  | boolean
  | null
  | SanitisedValue[]
  | { [key: string]: SanitisedValue };

/**
 * Recursively strips secrets (by key name and by value shape) from audit-log
 * metadata before it is returned over the API.
 *
 * Guarantees:
 * - Password hashes, tokens, private keys, card data and similar values are
 *   replaced with `[REDACTED]`.
 * - BigInts become strings; Dates become ISO strings; cycles are cut.
 * - Output is JSON-safe.
 */
export function sanitiseAuditMetadata(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): SanitisedValue {
  if (value === null || value === undefined) {
    return null;
  }

  switch (typeof value) {
    case 'bigint':
      return value.toString();
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'string':
      return looksLikeSecret(value) ? REDACTED : truncate(value);
    case 'object':
      break;
    default:
      return REDACTED;
  }

  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value)) {
    return '[CYCLE]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitiseAuditMetadata(item, depth + 1, seen));
  }

  const output: { [key: string]: SanitisedValue } = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSecretKey(key)
      ? REDACTED
      : sanitiseAuditMetadata(entry, depth + 1, seen);
  }

  return output;
}

function truncate(value: string): string {
  const MAX_LENGTH = 4000;
  return value.length > MAX_LENGTH
    ? `${value.slice(0, MAX_LENGTH)}…[truncated]`
    : value;
}
