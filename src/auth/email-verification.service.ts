import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

/** How long a verification token stays valid. */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Minimum number of seconds between two verification email sends. */
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

export type ResendVerificationEmailResult =
  | { status: 'sent'; cooldownSeconds: number }
  | { status: 'throttled'; retryAfterSeconds: number }
  | { status: 'already_verified' };

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a fresh verification token for the user, replacing any previous
   * unused token, and returns the raw token (only the hash is persisted).
   */
  async issueToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');

    // One active token per user: drop stale tokens before creating a new one.
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId, usedAt: null },
    });
    await this.prisma.emailVerificationToken.create({
      data: {
        tokenHash: EmailVerificationService.hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });

    return token;
  }

  /**
   * Issues a verification token and sends the verification email.
   * Delivery failures are logged but never thrown, so registration and
   * resend flows stay resilient when SMTP is not configured.
   */
  async sendVerificationEmail(
    user: Pick<User, 'id' | 'email' | 'firstName'>,
  ): Promise<void> {
    const token = await this.issueToken(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationSentAt: new Date() },
    });

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const verifyUrl = `${appUrl}/verify-email?token=${token}`;

    try {
      await this.emailService.sendTransactionalEmail({
        to: user.email,
        subject: 'Verify your PetAd email address',
        text: [
          `Hi ${user.firstName},`,
          '',
          'Welcome to PetAd! Please confirm your email address to start adopting,',
          'fostering and messaging other users.',
          '',
          `Your verification token: ${token}`,
          `Or open this link: ${verifyUrl}`,
          '',
          'This token expires in 24 hours.',
          'If you did not create a PetAd account, you can ignore this email.',
        ].join('\n'),
        html: `
          <p>Hi ${user.firstName},</p>
          <p>Welcome to PetAd! Please confirm your email address to start adopting, fostering and messaging other users.</p>
          <p><a href="${verifyUrl}">Verify my email</a></p>
          <p>Or use this token: <code>${token}</code></p>
          <p>This token expires in 24 hours. If you did not create a PetAd account, you can ignore this email.</p>
        `,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send verification email to ${user.email}: ${reason}`,
      );
    }
  }

  /**
   * Verifies an email address from a raw verification token.
   * Throws 400 for unknown, used or expired tokens.
   */
  async verifyEmail(
    token: string,
  ): Promise<{ message: string; email: string }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: EmailVerificationService.hashToken(token) },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Verification token is invalid or has expired',
      });
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
    ]);

    return { message: 'Email verified successfully', email: record.user.email };
  }

  /**
   * Re-sends the verification email for the current user, enforcing a
   * 60-second cooldown between sends.
   */
  async resendVerificationEmail(
    userId: string,
  ): Promise<ResendVerificationEmailResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerifiedAt) {
      return { status: 'already_verified' };
    }

    const sentAt = user.emailVerificationSentAt;
    if (sentAt) {
      const elapsedMs = Date.now() - sentAt.getTime();
      const cooldownMs = EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
      if (elapsedMs < cooldownMs) {
        return {
          status: 'throttled',
          retryAfterSeconds: Math.ceil((cooldownMs - elapsedMs) / 1000),
        };
      }
    }

    await this.sendVerificationEmail(user);
    return {
      status: 'sent',
      cooldownSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    };
  }
}
