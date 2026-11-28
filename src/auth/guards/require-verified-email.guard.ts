import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';

interface AuthenticatedRequest extends Request {
  user?: { sub?: string; userId?: string };
}

/**
 * Rejects requests from accounts whose email address has not been verified.
 *
 * The verification state is read from the database on every gated request so
 * a stale JWT can never unlock a route after a verification is reversed.
 */
@Injectable()
export class RequireVerifiedEmailGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.userId ?? request.user?.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });

    if (!user?.emailVerifiedAt) {
      throw new ForbiddenException({
        code: ErrorCode.EMAIL_NOT_VERIFIED,
        message:
          'Email verification required. Verify your email address to continue.',
      });
    }

    return true;
  }
}
