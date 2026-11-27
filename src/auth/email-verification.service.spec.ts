import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  EmailVerificationService,
  EMAIL_VERIFICATION_COOLDOWN_SECONDS,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
} from './email-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  emailVerificationToken: {
    updateMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockEmailService = { sendTransactionalEmail: jest.fn() };

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
        callback(mockPrisma),
    );
    mockPrisma.emailVerificationToken.create.mockResolvedValue({ id: 'tok-1' });
    mockPrisma.emailVerificationToken.update.mockResolvedValue({ id: 'tok-1' });
    mockPrisma.emailVerificationToken.updateMany.mockResolvedValue({
      count: 0,
    });
    mockPrisma.emailVerificationToken.deleteMany.mockResolvedValue({
      count: 0,
    });
    mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });
    mockEmailService.sendTransactionalEmail.mockResolvedValue({
      messageId: 'msg-1',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
  });

  describe('sendVerification', () => {
    it('stores a hashed single-use token and emails the raw token', async () => {
      await service.sendVerification('user-1', 'user@example.com');

      expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith(
        {
          where: { userId: 'user-1', used: false },
          data: { used: true },
        },
      );

      const [[createCall]] = mockPrisma.emailVerificationToken.create.mock
        .calls as unknown as [
        [{ data: { tokenHash: string; expiresAt: Date } }],
      ];
      const { tokenHash, expiresAt } = createCall.data;

      expect(tokenHash).toHaveLength(64);
      expect(expiresAt.getTime()).toBeGreaterThan(
        Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS - 60_000,
      );

      const [[emailCall]] = mockEmailService.sendTransactionalEmail.mock
        .calls as unknown as [[{ to: string; text: string }]];
      expect(emailCall.to).toBe('user@example.com');

      const rawToken = /token is: ([a-f0-9]{64})/.exec(emailCall.text)?.[1];
      expect(rawToken).toBeDefined();
      expect(sha256(rawToken as string)).toBe(tokenHash);
    });

    it('never fails when the email cannot be delivered', async () => {
      mockEmailService.sendTransactionalEmail.mockRejectedValue(
        new Error('SMTP down'),
      );

      await expect(
        service.sendVerification('user-1', 'user@example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('marks the address verified and consumes the token', async () => {
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        used: false,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', emailVerifiedAt: null },
      });

      const result = await service.verify('raw-token');

      expect(mockPrisma.emailVerificationToken.findUnique).toHaveBeenCalledWith(
        {
          where: { tokenHash: sha256('raw-token') },
          include: { user: { select: { id: true, emailVerifiedAt: true } } },
        },
      );
      expect(mockPrisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: { id: 'tok-1' },
        data: { used: true },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerifiedAt: expect.any(Date) as unknown as Date },
      });
      expect(mockPrisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith(
        {
          where: { userId: 'user-1', id: { not: 'tok-1' } },
        },
      );
      expect(result.message).toBe('Email verified successfully');
      expect(result.emailVerifiedAt).toEqual(expect.any(String));
    });

    it('keeps the original verification timestamp when re-verifying', async () => {
      const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        used: false,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', emailVerifiedAt: verifiedAt },
      });

      const result = await service.verify('raw-token');

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(result.emailVerifiedAt).toBe(verifiedAt.toISOString());
    });

    it.each([
      ['unknown', null],
      [
        'used',
        {
          used: true,
          expiresAt: new Date(Date.now() + 60_000),
          user: { emailVerifiedAt: null },
        },
      ],
      [
        'expired',
        {
          used: false,
          expiresAt: new Date(Date.now() - 1_000),
          user: { emailVerifiedAt: null },
        },
      ],
    ])('rejects a %s token with 400', async (_label, record) => {
      mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(record);

      const error = await service
        .verify('bad-token')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_EMAIL_VERIFICATION_TOKEN',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resend', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        status: 'ACTIVE',
        emailVerifiedAt: null,
      });
    });

    it('sends a new verification email when no recent token exists', async () => {
      mockPrisma.emailVerificationToken.findFirst.mockResolvedValue(null);

      const result = await service.resend('user-1');

      expect(result.retryAfterSeconds).toBe(
        EMAIL_VERIFICATION_COOLDOWN_SECONDS,
      );
      expect(mockEmailService.sendTransactionalEmail).toHaveBeenCalled();
    });

    it('returns 429 with retryAfterSeconds during the cooldown', async () => {
      mockPrisma.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 10_000),
      });

      const error = await service
        .resend('user-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      const body = (error as HttpException).getResponse() as {
        code: string;
        retryAfterSeconds: number;
      };
      expect(body.code).toBe('EMAIL_VERIFICATION_COOLDOWN');
      expect(body.retryAfterSeconds).toBeGreaterThan(40);
      expect(body.retryAfterSeconds).toBeLessThanOrEqual(50);
      expect(mockEmailService.sendTransactionalEmail).not.toHaveBeenCalled();
    });

    it('allows a resend once the cooldown has elapsed', async () => {
      mockPrisma.emailVerificationToken.findFirst.mockResolvedValue({
        createdAt: new Date(
          Date.now() - (EMAIL_VERIFICATION_COOLDOWN_SECONDS + 5) * 1000,
        ),
      });

      await expect(service.resend('user-1')).resolves.toMatchObject({
        message: 'Verification email sent',
      });
    });

    it('rejects when the email is already verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      });

      await expect(service.resend('user-1')).rejects.toThrow(ConflictException);
    });
  });
});
