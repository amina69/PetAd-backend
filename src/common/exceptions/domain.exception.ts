import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Exception thrown when a domain rule (e.g. invalid state transition) is violated.
 * Carries an HTTP 422 Unprocessable Entity status.
 */
export class DomainException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
