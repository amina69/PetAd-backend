import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap, catchError } from 'rxjs';
import { LoggingService } from '../../logging/logging.service';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly loggingService: LoggingService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, originalUrl } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;

        this.loggingService.log({
          level: 'INFO',
          action: 'HTTP_REQUEST',
          message: `${method} ${originalUrl} ${response.statusCode}`,
          userId: request.user?.sub,
          metadata: {
            method,
            path: originalUrl,
            statusCode: response.statusCode,
            duration,
          },
        });
      }),

      catchError((error) => {
        const duration = Date.now() - startTime;

        this.loggingService.log({
          level: 'ERROR',
          action: 'HTTP_ERROR',
          message: error.message,
          userId: request.user?.sub,
          metadata: {
            method,
            path: originalUrl,
            duration,
          },
        });

        throw error;
      }),
    );
  }
}