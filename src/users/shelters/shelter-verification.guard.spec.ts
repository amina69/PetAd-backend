import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ShelterVerificationStatus } from '@prisma/client';
import { ShelterVerificationGuard } from './shelter-verification.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShelterVerificationGuard', () => {
  let guard: ShelterVerificationGuard;

  const mockPrisma = {
    shelterProfile: { findUnique: jest.fn() },
  };

  const contextWith = (user?: {
    sub?: string;
    userId?: string;
    role?: string;
  }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShelterVerificationGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get(ShelterVerificationGuard);
  });

  it('allows verified shelters', async () => {
    mockPrisma.shelterProfile.findUnique.mockResolvedValue({
      verificationStatus: ShelterVerificationStatus.APPROVED,
    });

    await expect(
      guard.canActivate(contextWith({ sub: 'shelter-1', role: 'SHELTER' })),
    ).resolves.toBe(true);
  });

  it('blocks shelters without a profile with 403 SHELTER_NOT_VERIFIED', async () => {
    mockPrisma.shelterProfile.findUnique.mockResolvedValue(null);

    const promise = guard.canActivate(
      contextWith({ sub: 'shelter-1', role: 'SHELTER' }),
    );

    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await promise.catch((error: ForbiddenException) => {
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toMatchObject({
        code: 'SHELTER_NOT_VERIFIED',
      });
    });
  });

  it.each([
    ShelterVerificationStatus.PENDING,
    ShelterVerificationStatus.REJECTED,
  ])('blocks shelters with %s status', async (status) => {
    mockPrisma.shelterProfile.findUnique.mockResolvedValue({
      verificationStatus: status,
    });

    await expect(
      guard.canActivate(contextWith({ sub: 'shelter-1', role: 'SHELTER' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets admins through without a shelter profile', async () => {
    await expect(
      guard.canActivate(contextWith({ sub: 'admin-1', role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(mockPrisma.shelterProfile.findUnique).not.toHaveBeenCalled();
  });

  it('throws 401 when there is no authenticated user', async () => {
    await expect(
      guard.canActivate(contextWith(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
