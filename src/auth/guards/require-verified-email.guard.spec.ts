import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequireVerifiedEmailGuard } from './require-verified-email.guard';
import { PrismaService } from '../../prisma/prisma.service';

const contextWithUser = (user?: { sub?: string; userId?: string }) =>
  ({
    getHandler: () => ({}),
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RequireVerifiedEmailGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RequireVerifiedEmailGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    guard = new RequireVerifiedEmailGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
  });

  it('passes through when the route is not gated', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(contextWithUser())).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows a user with a verified email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
    });

    await expect(
      guard.canActivate(contextWithUser({ userId: 'user-1' })),
    ).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { emailVerifiedAt: true },
    });
  });

  it('rejects an unverified user with 403 EMAIL_NOT_VERIFIED', async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null });

    const error = await guard
      .canActivate(contextWithUser({ sub: 'user-1' }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('rejects a missing user as unauthorized', async () => {
    await expect(guard.canActivate(contextWithUser())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
