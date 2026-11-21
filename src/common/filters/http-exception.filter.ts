import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { AppConfig } from '../../config/env.schema';
import { ErrorCode } from '../exceptions/error-codes';
import { ERROR_CODE_STATUS } from '../exceptions/error-codes';
import { AppException } from '../exceptions/app.exception';
import { LoggingService } from '../../logging/logging.service';

/**
 * Prisma error codes we map to structured HTTP errors.
 */
const PRISMA_ERROR_CODES: Record<string, { status: number; code: ErrorCode }> = {
  P2002: { status: HttpStatus.CONFLICT, code: 'UNIQUE_CONSTRAINT' },
  P2025: { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' },
};

/**
 * Standardized error response shape (public contract):
 * `{ statusCode, code, message, details?, requestId, timestamp, path }`
 */
interface StandardErrorResponse {
  statusCode: number;
  code: ErrorCode | string;
  message: string | object;
  details?: unknown;
  requestId: string;
  timestamp: string;
  path: string;
}

/**
 * Sentry initialization state.
 * Sentry is configured once at module load time based on the SENTRY_DSN.
 */
let sentryInitialized = false;

/**
 * Sentry exception filter that captures 5xx errors and unhandled job failures,
 * while ignoring expected 4xx errors. Integrates with the application's
 * standardized error response envelope.
 *
 * Features:
 * - Sentry integration, enabled only when SENTRY_DSN is configured
 * - Captures 5xx errors and unhandled job failures
 * - Includes release and environment information
 * - beforeSend removes request bodies, headers, tokens, emails, and other PII
 * - Only attaches the authenticated user's ID as user context
 * - Ignores expected 4xx errors
 */
@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly isProduction: boolean;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
  ) {
    this.isProduction =
      this.configService.get<string>('nodeEnv', 'development') === 'production';

    // Initialize Sentry once if DSN is configured
    this.initializeSentry();
  }

  /**
   * Initialize Sentry if SENTRY_DSN is configured.
   * Must be called once during application bootstrap.
   */
  private initializeSentry(): void {
    if (sentryInitialized) {
      return;
    }

    const dsn = this.configService.get<string>('sentryDsn');

    if (!dsn) {
      // Sentry is disabled - no events are sent
      return;
    }

    // Configure Sentry with DSN and environment info
    Sentry.init({
      dsn,
      environment: this.configService.get<string>('nodeEnv', 'development'),
      release: `${process.env.npm_package_name}-${process.env.npm_package_version}`,

      // Set up tracing for performance monitoring
      tracesSampleRate: 0.1,

      // beforeSend hook to remove PII and sensitive data
      beforeSend(event: any) {
        // Remove request bodies
        if (event.request && event.request.body) {
          event.request.body = '[redacted]';
        }

        // Remove cookies and authorization headers
        if (event.request && event.request.headers) {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(event.request.headers)) {
            const lowerKey = key.toLowerCase();
            if (
              lowerKey === 'authorization' ||
              lowerKey === 'cookie' ||
              lowerKey === 'x-request-id' ||
              lowerKey === 'x-email' ||
              lowerKey === 'x-user-email'
            ) {
              continue;
            }
            // Cast to string to satisfy TypeScript; headers values are typically strings
            headers[key] = value instanceof String ? value.toString() : String(value);
          }
          event.request.headers = headers;
        }

        // Remove user PII from context
        if (event.user && event.user.id) {
          // Keep only the user ID - strip email and other PII
          event.user = {
            id: String(event.user.id),
          };
        }

        // Remove PII from extra context
        this.removePIIFromEvent(event);

        return event;
      },

      // Ignore 4xx errors (client errors that are expected)
      ignoreErrors: [
        // These common 4xx errors are expected and should not be tracked
        '400',
        '401',
        '403',
        '404',
        '409',
        '415',
        '422',
        '429',
      ],

      // Set default integrations
      defaultIntegrations: false,
    });

    sentryInitialized = true;
  }

  /**
   * Remove PII from event data structures
   */
  private removePIIFromEvent(event: any): void {
    // Sanitize extra context
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        const value = event.extra[key];
        if (typeof value === 'string') {
          // Redact potential PII values
          if (this.isPotentiallyPII(value)) {
            event.extra[key] = '[redacted]';
          }
        }
      }
    }

    // Sanitize tags
    if (event.tags) {
      for (const key of Object.keys(event.tags)) {
        const value = event.tags[key];
        if (typeof value === 'string' && this.isPotentiallyPII(value)) {
          event.tags[key] = '[redacted]';
        }
      }
    }

    // Sanitize labels
    if (event.labels) {
      for (const key of Object.keys(event.labels)) {
        const value = event.labels[key];
        if (typeof value === 'string' && this.isPotentiallyPII(value)) {
          event.labels[key] = '[redacted]';
        }
      }
    }
  }

  /**
   * Check if a string value might contain PII
   */
  private isPotentiallyPII(value: string): boolean {
    const lower = value.toLowerCase();
    // Check for email patterns
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return true;
    }
    // Check for token-like values (short hex strings)
    if (/^[a-f0-9]{16,64}$/.test(value) || /^[a-f0-9]{8,}$/.test(value)) {
      return true;
    }
    // Check for common email/token patterns
    if (lower.includes('token') || lower.includes('secret') || lower.includes('key')) {
      return true;
    }
    // Check for email-like patterns (but not URLs)
    if (lower.includes('@') && lower.includes('.') && !lower.includes('http')) {
      return true;
    }
    return false;
  }

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const requestId: string =
      (request as any).requestId ??
      request.headers['x-request-id'] ??
      (Sentry as any).getCurrentHub()?.getScope()?.getTransaction()?.getId() ??
      crypto.randomUUID();

    const mapped = this.mapException(exception, this.isProduction);
    const status = mapped.status;
    const code = mapped.code;
    const message = mapped.message;
    const details = mapped.details;

    // JwtStrategy populates `sub`; some callers still read `userId`.
    const { user: requestUser } = request as unknown as {
      user?: { sub?: string; userId?: string };
    };

    // Log the error (always log, even for 4xx)
    await this.loggingService.log({
      level: 'ERROR',
      action: 'HTTP_EXCEPTION',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      userId: requestUser?.sub ?? requestUser?.userId,
      metadata: {
        statusCode: status,
        path: request.url,
        method: request.method,
      },
    });

    const body: StandardErrorResponse = {
      statusCode: status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Capture 5xx errors in Sentry; ignore 4xx errors
    const statusNum: number = status;
    if (statusNum >= 500) {
      this.captureInSentry(exception, request, requestId);
    } else if (statusNum >= 400 && statusNum < 500) {
      // Expected 4xx errors - do not capture in Sentry
      // The standardized response is already sent above
    }

    response.status(status).json(body);
  }

  /**
   * Capture exception in Sentry with user context and PII removal.
   */
  private captureInSentry(
    exception: unknown,
    request: Request,
    requestId: string,
  ): void {
    const userId = this.extractUserId(request);

    Sentry.withScope((scope: any) => {
      // Set the user context - only authenticated user's ID
      if (userId) {
        scope.setUser({ id: userId });
      }

      // Add request context
      scope.setTag('requestId', requestId);
      scope.setTag('path', request.url);
      scope.setTag('method', request.method);
      scope.setTag('environment', this.configService.get<string>('nodeEnv', 'development'));

      // Capture the exception
      Sentry.captureException(exception);
    });
  }

  /**
   * Extract the authenticated user's ID from the request.
   * Only the user ID is used as Sentry context - no email or other PII.
   */
  private extractUserId(request: Request): string | null {
    try {
      const user = (request as any).user;

      if (!user) {
        return null;
      }

      // Accept either `sub` or `userId` from the JWT payload
      const userId = user.sub ?? user.userId;

      if (!userId) {
        return null;
      }

      return String(userId);
    } catch {
      return null;
    }
  }

  private mapException(
    exception: unknown,
    production: boolean,
  ): {
    status: number;
    code: ErrorCode | string;
    message: string | object;
    details?: unknown;
  } {
    // Custom structured exceptions carry their own code/status/message.
    if (exception instanceof AppException) {
      const response = exception.getResponse() as {
        statusCode: number;
        code: ErrorCode | string;
        message: string | object;
        details?: unknown;
      };
      return {
        status: exception.statusCode,
        code: response.code ?? exception.code,
        message: response.message,
        details: response.details ?? exception.details,
      };
    }

    // NestJS HttpException (e.g. UnauthorizedException, NotFoundException,
    // BadRequestException from ValidationPipe/guards).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as
        | {
            message?: string | object;
            code?: string;
            error?: string;
            details?: unknown;
            [key: string]: unknown;
          }
        | string;

      let code: ErrorCode | string = this.statusToCode(status);
      let message: string | object = 'An error occurred';
      let details: unknown = undefined;

      if (typeof response === 'object' && response !== null) {
        if (typeof response.code === 'string') code = response.code;
        message = response.message ?? response.error ?? message;
        if (Array.isArray(response.message)) {
          // ValidationPipe details: array of constraint violations.
          details = response.message;
          message = 'Validation failed';
        } else if (response.details !== undefined) {
          details = response.details;
        } else {
          // Structured exceptions may carry extra machine-readable fields
          // (e.g. `reasons` for blocked account deletion). Keep the standard
          // envelope and expose those fields under `details`.
          const extras = Object.keys(response).filter(
            (key) =>
              !['statusCode', 'code', 'message', 'error', 'details'].includes(
                key,
              ),
          );
          if (extras.length > 0) {
            details = Object.fromEntries(
              extras.map((key) => [key, response[key]]),
            );
          }
        }
      } else if (typeof response === 'string') {
        message = response;
      }

      return { status, code, message, details };
    }

    // Prisma ORM errors.
    if (exception instanceof Error && (exception as any).code) {
      const prismaCode = (exception as any).code as string;
      const mapping = PRISMA_ERROR_CODES[prismaCode];
      if (mapping) {
        const target = (exception as any).meta?.target;
        return {
          status: mapping.status,
          code: mapping.code,
          message:
            mapping.code === 'UNIQUE_CONSTRAINT'
              ? `Unique constraint violation${target ? ` on ${String(target)}` : ''}`
              : 'Record not found',
          details: prismaCode === 'P2002' ? target : undefined,
        };
      }

      // Prisma client initialization / connection errors.
      if (
        exception.constructor.name === 'PrismaClientInitializationError'
      ) {
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database service unavailable',
        };
      }
    }

    // BullMQ / queue and Stellar integration errors surface through
    // service-layer exceptions; match by name/code conventions.
    const name = exception instanceof Error ? exception.constructor.name : '';
    const message = exception instanceof Error ? exception.message : String(exception);

    if (/Queue|Bull|Job/.test(name)) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        code: 'QUEUE_ERROR',
        message: 'Job queue error',
        details: production ? undefined : message,
      };
    }

    if (/Stellar|Horizon|TransactionBuild/.test(name)) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        code: 'STELLAR_ERROR',
        message: 'Blockchain integration error',
        details: production ? undefined : message,
      };
    }

    // Fallback: never leak internal error details to the client.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: production
        ? 'Internal server error'
        : message || 'Internal server error',
      details: production ? undefined : undefined,
    };
  }

  private statusToCode(status: number): ErrorCode | string {
    const code = Object.entries(ERROR_CODE_STATUS).find(
      ([, mappedStatus]) => mappedStatus === status,
    )?.[0] as ErrorCode | undefined;
    return code ?? 'INTERNAL_SERVER_ERROR';
  }
}