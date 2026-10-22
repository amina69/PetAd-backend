import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { RequireVerifiedEmailGuard } from './require-verified-email.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('RequireVerifiedEmailGuard', () => {
  let guard: RequireVerifiedEmailGuard;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
  };

  const contextWith = (user?: { sub?: string; userId?: string }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequireVerifiedEmailGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get(RequireVerifiedEmailGuard);
  });

  it('allows requests from users with a verified email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
    });

    await expect(
      guard.canActivate(contextWith({ sub: 'user-1' })),
    ).resolves.toBe(true);
  });

  it('blocks unverified users with 403 EMAIL_NOT_VERIFIED', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null });

    const promise = guard.canActivate(contextWith({ sub: 'user-1' }));

    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await promise.catch((error: ForbiddenException) => {
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
    });
  });

  it('supports both sub and userId claims', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
    });

    await expect(
      guard.canActivate(contextWith({ userId: 'user-2' })),
    ).resolves.toBe(true);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      select: { emailVerifiedAt: true },
    });
  });

  it('throws 401 when there is no authenticated user', async () => {
    await expect(
      guard.canActivate(contextWith(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the user no longer exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextWith({ sub: 'deleted-user' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
