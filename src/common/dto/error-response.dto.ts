import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Single entry in the `details` array of a standardized error response
 * (e.g. one constraint violation per field).
 */
export class ErrorDetailDto {
  @ApiPropertyOptional({ example: 'email' })
  field?: string;

  @ApiProperty({ example: 'email must be a valid email address' })
  message: string;
}

/**
 * Standardized error response envelope (public contract):
 * `{ statusCode, code, message, details?, requestId, timestamp, path }`
 *
 * Registered as an extra Swagger model so every endpoint can reference it.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code' })
  statusCode: number;

  @ApiProperty({ example: 'VALIDATION_ERROR', description: 'Stable error code' })
  code: string;

  @ApiProperty({
    description: 'Human-readable error message',
    oneOf: [{ type: 'string' }, { type: 'object' }],
  })
  message: string | object;

  @ApiPropertyOptional({
    type: [ErrorDetailDto],
    description: 'Validation details, when applicable',
  })
  details?: ErrorDetailDto[];

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Request identifier echoed in the X-Request-Id header',
  })
  requestId: string;

  @ApiProperty({
    example: '2026-10-22T00:00:00.000Z',
    description: 'Timestamp of the response (ISO 8601)',
  })
  timestamp: string;

  @ApiProperty({
    example: '/api/v1/auth/register',
    description: 'Request path',
  })
  path: string;
}
