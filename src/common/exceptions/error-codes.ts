/**
 * Stable, machine-readable error codes used across the API.
 *
 * Codes are part of the public contract: do not rename or remove them.
 * Prefer adding new codes here rather than inventing inline strings.
 */
export const ErrorCode = {
  // 4xx - client errors
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  UNIQUE_CONSTRAINT: 'UNIQUE_CONSTRAINT',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  PET_INVALID_TRANSITION: 'PET_INVALID_TRANSITION',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  RATE_LIMITED: 'RATE_LIMITED',

  // 5xx - server errors
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Integrations
  QUEUE_ERROR: 'QUEUE_ERROR',
  STELLAR_ERROR: 'STELLAR_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP status code associated with each error code (default mapping). */
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNIQUE_CONSTRAINT: 409,
  EMAIL_ALREADY_EXISTS: 409,
  CONFLICT: 409,
  PET_INVALID_TRANSITION: 422,
  UNPROCESSABLE_ENTITY: 422,
  RATE_LIMITED: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  QUEUE_ERROR: 502,
  STELLAR_ERROR: 502,
};
