/**
 * A failure that retrying cannot fix (invalid address, hard bounce,
 * suppressed recipient). Queue layers must not retry these.
 */
export class PermanentEmailError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | 'INVALID_ADDRESS'
      | 'HARD_BOUNCE'
      | 'SUPPRESSED'
      | 'NOT_CONFIGURED' = 'INVALID_ADDRESS',
  ) {
    super(message);
    this.name = 'PermanentEmailError';
  }
}

/** A failure that may succeed on a later attempt (timeouts, 4xx). */
export class TransientEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientEmailError';
  }
}

/** Per-recipient rate limit exhausted; retry later. */
export class EmailRateLimitError extends TransientEmailError {
  constructor(message: string) {
    super(message);
    this.name = 'EmailRateLimitError';
  }
}
