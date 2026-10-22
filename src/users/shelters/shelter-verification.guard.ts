import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ShelterVerificationStatus } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Blocks unverified shelters from publishing listings with
 * 403 SHELTER_NOT_VERIFIED. Admins bypass the check; regular USER accounts
 * are expected to be blocked earlier by the roles guard on the route.
 */
@Injectable()
export class ShelterVerificationGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as
      | { sub?: string; userId?: string; role?: string }
      | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role === 'ADMIN') {
      return true;
    }

    const userId = user.userId ?? user.sub;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const profile = await this.prisma.shelterProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true },
    });

    if (
      !profile ||
      profile.verificationStatus !== ShelterVerificationStatus.APPROVED
    ) {
      throw new ForbiddenException({
        code: 'SHELTER_NOT_VERIFIED',
        message:
          'Shelter profile is not verified. An admin must verify your shelter before you can publish listings.',
      });
    }

    return true;
  }
}
