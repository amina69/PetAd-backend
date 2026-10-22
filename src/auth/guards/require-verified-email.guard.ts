import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Blocks the request with 403 EMAIL_NOT_VERIFIED unless the authenticated
 * user has a non-null `emailVerifiedAt`. The email status is read from the
 * database (not the JWT) so it is fresh right after verification.
 */
@Injectable()
export class RequireVerifiedEmailGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authUser = request.user as
      | { sub?: string; userId?: string }
      | undefined;
    const userId = authUser?.userId ?? authUser?.sub;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Email address is not verified. Please verify your email before continuing.',
      });
    }

    return true;
  }
}
