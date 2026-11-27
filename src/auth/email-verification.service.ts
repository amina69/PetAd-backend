import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ErrorCode } from '../common/exceptions/error-codes';

/** A new verification email may only be requested once per minute. */
export const EMAIL_VERIFICATION_COOLDOWN_SECONDS = 60;

/** Verification tokens stay usable for 24 hours. */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Issues a fresh single-use token, invalidates any outstanding ones and
   * emails the token to the user. Delivery failures are logged rather than
   * thrown so registration never fails because SMTP is misconfigured.
   */
  async sendVerification(userId: string, email: string): Promise<void> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId, used: false },
        data: { used: true },
      });

      await tx.emailVerificationToken.create({
        data: { tokenHash, userId, expiresAt },
      });
    });

    try {
      await this.emailService.sendTransactionalEmail({
        to: email,
        subject: 'Verify your PetAd email address',
        text:
          `Your PetAd email verification token is: ${rawToken}\n\n` +
          'It expires in 24 hours. Submit it to POST /auth/email/verify ' +
          'to verify your address.',
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email verification to ${email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Consumes a verification token and marks the address as verified. */
  async verify(token: string) {
    const tokenHash = this.hashToken(token);

    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, emailVerifiedAt: true } } },
    });

    if (!record || record.used || record.expiresAt < new Date()) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_EMAIL_VERIFICATION_TOKEN,
        message: 'Invalid or expired email verification token',
      });
    }

    const emailVerifiedAt = record.user.emailVerifiedAt ?? new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { used: true },
      });

      if (!record.user.emailVerifiedAt) {
        await tx.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt },
        });
      }

      await tx.emailVerificationToken.deleteMany({
        where: { userId: record.userId, id: { not: record.id } },
      });
    });

    return {
      message: 'Email verified successfully',
      emailVerifiedAt: emailVerifiedAt.toISOString(),
    };
  }

  /**
   * Re-sends a verification email for the authenticated user.
   *
   * @throws HttpException 429 (with `retryAfterSeconds`) while the cooldown
   *   is active, so the controller can expose a Retry-After header.
   */
  async resend(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
      },
    });

    if (!user || user.status === 'DELETED') {
      throw new UnauthorizedException('User not found');
    }

    if (user.emailVerifiedAt) {
      throw new ConflictException({
        code: ErrorCode.EMAIL_ALREADY_VERIFIED,
        message: 'Email address is already verified',
      });
    }

    const lastToken = await this.prisma.emailVerificationToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (lastToken) {
      const elapsedMs = Date.now() - lastToken.createdAt.getTime();
      const remainingMs =
        EMAIL_VERIFICATION_COOLDOWN_SECONDS * 1000 - elapsedMs;

      if (remainingMs > 0) {
        const retryAfterSeconds = Math.ceil(remainingMs / 1000);
        throw new HttpException(
          {
            code: ErrorCode.EMAIL_VERIFICATION_COOLDOWN,
            message: `A verification email was sent recently. Retry in ${retryAfterSeconds} seconds.`,
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.sendVerification(user.id, user.email);

    return {
      message: 'Verification email sent',
      retryAfterSeconds: EMAIL_VERIFICATION_COOLDOWN_SECONDS,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
