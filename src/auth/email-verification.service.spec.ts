import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EmailVerificationService,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from './email-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  const mockPrisma = {
    emailVerificationToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockEmailService = {
    sendTransactionalEmail: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get(EmailVerificationService);
  });

  describe('issueToken', () => {
    it('stores only the sha256 hash of the token and replaces stale tokens', async () => {
      mockPrisma.emailVerificationToken.create.mockResolvedValue({});

      const token = await service.issueToken('user-1');

      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(mockPrisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith(
        {
          where: { userId: 'user-1', usedAt: null },
        },
      );
      expect(mockPrisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: EmailVerificationService.hashToken(token),
          userId: 'user-1',
          expiresAt: expect.any(Date) as Date,
        },
      });
      // The raw token must never be persisted.
      const createMock = mockPrisma.emailVerificationToken.create as jest.Mock<
        Promise<unknown>,
        [{ data: { tokenHash: string } }]
      >;
      const createCall = createMock.mock.calls[0][0];
      expect(createCall.data.tokenHash).not.toBe(token);
    });
  });

  describe('verifyEmail', () => {
    it('verifies the user and marks the token used for a valid token', async () => {
      const now = new Date();
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        user: { id: 'user-1', email: 'user@test.com' },
      });
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.verifyEmail('raw-token');

      expect(result).toEqual({
        message: 'Email verified successfully',
        email: 'user@test.com',
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(now).toBeDefined();
    });

    it('throws 400 for an unknown token', async () => {
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('nope')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 for an expired token', async () => {
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        user: { id: 'user-1', email: 'user@test.com' },
      });

      await expect(service.verifyEmail('expired')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 for an already used token', async () => {
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        user: { id: 'user-1', email: 'user@test.com' },
      });

      await expect(service.verifyEmail('used')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resendVerificationEmail', () => {
    it('sends when nothing was sent before', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'Test',
        emailVerifiedAt: null,
        emailVerificationSentAt: null,
      });
      mockPrisma.emailVerificationToken.deleteMany.mockResolvedValue({});
      mockPrisma.emailVerificationToken.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockEmailService.sendTransactionalEmail.mockResolvedValue({
        message: 'Email sent successfully',
      });

      const result = await service.resendVerificationEmail('user-1');

      expect(result).toEqual({
        status: 'sent',
        cooldownSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
      });
      expect(mockEmailService.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    });

    it('is throttled with a retryAfter inside the cooldown window', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'Test',
        emailVerifiedAt: null,
        emailVerificationSentAt: new Date(Date.now() - 20_000),
      });

      const result = await service.resendVerificationEmail('user-1');

      expect(result.status).toBe('throttled');
      if (result.status === 'throttled') {
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(
          EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
        );
      }
      expect(mockEmailService.sendTransactionalEmail).not.toHaveBeenCalled();
    });

    it('allows resend once the cooldown has elapsed', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'Test',
        emailVerifiedAt: null,
        emailVerificationSentAt: new Date(
          Date.now() - (EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS + 5) * 1000,
        ),
      });
      mockPrisma.emailVerificationToken.deleteMany.mockResolvedValue({});
      mockPrisma.emailVerificationToken.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockEmailService.sendTransactionalEmail.mockResolvedValue({
        message: 'Email sent successfully',
      });

      const result = await service.resendVerificationEmail('user-1');

      expect(result.status).toBe('sent');
    });

    it('reports already_verified without sending', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'Test',
        emailVerifiedAt: new Date(),
        emailVerificationSentAt: null,
      });

      const result = await service.resendVerificationEmail('user-1');

      expect(result).toEqual({ status: 'already_verified' });
      expect(mockEmailService.sendTransactionalEmail).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resendVerificationEmail('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('swallows transport errors so callers never fail on delivery', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'Test',
        emailVerifiedAt: null,
        emailVerificationSentAt: null,
      });
      mockPrisma.emailVerificationToken.deleteMany.mockResolvedValue({});
      mockPrisma.emailVerificationToken.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockEmailService.sendTransactionalEmail.mockRejectedValue(
        new Error('SMTP down'),
      );

      await expect(service.resendVerificationEmail('user-1')).resolves.toEqual({
        status: 'sent',
        cooldownSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
      });
    });
  });
});
