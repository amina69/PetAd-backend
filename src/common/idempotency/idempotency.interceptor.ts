import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { IDEMPOTENT_KEY } from './idempotency.decorator';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isIdempotent) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for this endpoint.',
      );
    }

    const userId: string = (req as any).user?.id ?? 'anonymous';
    const route = `${req.method}:${req.route?.path ?? req.path}`;
    const requestHash = this.idempotencyService.hashBody(req.body);

    return from(
      this.idempotencyService.check(idempotencyKey, userId, route, requestHash),
    ).pipe(
      switchMap((stored) => {
        if (stored) {
          // Replay the previously stored response.
          res.status(stored.statusCode);
          return from(Promise.resolve(stored.body));
        }

        // Reserve the key before processing.
        return from(
          this.idempotencyService.reserve(
            idempotencyKey,
            userId,
            route,
            requestHash,
          ),
        ).pipe(
          switchMap(() =>
            next.handle().pipe(
              tap(async (body) => {
                await this.idempotencyService.complete(
                  idempotencyKey,
                  userId,
                  route,
                  res.statusCode,
                  body,
                );
              }),
              catchError((err) => {
                // Release the reservation so the client can retry.
                void this.idempotencyService.release(
                  idempotencyKey,
                  userId,
                  route,
                );
                return throwError(() => err);
              }),
            ),
          ),
        );
      }),
    );
  }
}
