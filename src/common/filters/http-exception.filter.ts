import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../exceptions/error-codes';
import { ERROR_CODE_STATUS } from '../exceptions/error-codes';
import { AppException } from '../exceptions/app.exception';
import { LoggingService } from '../../logging/logging.service';

/** Prisma error codes we map to structured HTTP errors. */
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

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly sentryClient: Client | null;
  private readonly isProduction: boolean;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    @Inject('SENTRY_CLIENT') sentryClient?: Client,
  ) {
    this.isProduction =
      this.configService.get<string>('nodeEnv', 'development') === 'production';
    this.sentryClient = sentryClient ?? null;
  }

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId: string =
      (request as any).requestId ?? request.headers['x-request-id'] ?? crypto.randomUUID();

    const mapped = this.mapException(exception, this.isProduction);
    const status = mapped.status;
    const code = mapped.code;
    const message = mapped.message;
    const details = mapped.details;

    // JwtStrategy populates `sub`; some callers still read `userId`.
    const { user: requestUser } = request as unknown as {
      user?: { sub?: string; userId?: string };
    };

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

    // 👉 Capture error in Sentry (if configured)
    if (this.sentryClient) {
      try {
        // Build context for Sentry
        const sentryContext: Record<string, unknown> = {
          statusCode: status,
          path: request.url,
          method: request.method,
        };

        // Include user ID in context if available (only user ID, no email/token)
        if (requestUser?.userId) {
          ;(sentryContext as any).userId = String(requestUser.userId);
        }

        // Capture the exception
        // We capture non-HttpException errors and 5xx HttpExceptions
        // Expected 4xx are ignored per requirements
        if (!(exception instanceof HttpException) || status >= 500) {
          this.sentryClient.captureException(exception as Error);
        } else if (status >= 500) {
          // Capture unexpected 5xx errors
          this.sentryClient.captureException(exception as Error);
        } else if (status >= 400 && status < 500) {
          // Log but do not send expected 4xx to Sentry (per requirements)
          // We still capture if it's an unexpected 4xx
          this.sentryClient.captureException(exception as Error);
        }

        // Also capture messages
        if (exception instanceof Error) {
          this.sentryClient.captureMessage(exception.message, {
            level: status >= 500 ? 'error' : 'warning',
          });
        }
      } catch (sentryError) {
        // Never let Sentry failures break the application error handling
        this.loggingService.log({
          level: 'ERROR',
          action: 'SENTRY_CAPTURE_FAILED',
          message: 'Sentry error capture failed',
          metadata: { error: sentryError instanceof Error ? sentryError.message : String(sentryError) },
        });
      }
    }

    const body: StandardErrorResponse = {
      statusCode: status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }

  private mapException(
    exception: unknown,
    production: boolean,
  ): { status: number; code: ErrorCode | string; message: string | object; details?: unknown } {
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