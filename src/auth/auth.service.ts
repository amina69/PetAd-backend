import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly forgotRateLimitMap = new Map<string, number>();
  private readonly loginAttempts = new Map<
    string,
    { count: number; lastAttempt: number }
  >();

  private recordFailedAttempt(key: string) {
    const current = this.loginAttempts.get(key) || {
      count: 0,
      lastAttempt: Date.now(),
    };
    this.loginAttempts.set(key, {
      count: current.count + 1,
      lastAttempt: Date.now(),
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Optional()
    private readonly emailService?: EmailService,
  ) {}

  private async generateAccessToken(user: {
    id: string;
    email: string;
    role: string;
  }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.sign(payload);
  }

  async refresh(token: string, userAgent?: string, ip?: string) {
    if (!token) {
      throw new UnauthorizedException('Refresh token missing');
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.session.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      // Reuse detected! Revoke the entire family
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected. Session revoked.',
      );
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke current session
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    // Generate new rotated refresh token in the same family
    const newAccessToken = await this.generateAccessToken(session.user);
    const newRefreshToken = await this.generateRefreshToken(
      session.userId,
      userAgent,
      ip,
      session.familyId,
    );

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        role: session.user.role,
        emailVerified: session.user.emailVerified,
      },
    };
  }

  async getCurrentUser(userId?: string) {
    if (!userId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
    };
  }

  async logout() {
    return { message: 'Logged out successfully' };
  }

  async cleanupExpiredSessions() {
    return this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }],
      },
    });
  }

  private async generateRefreshToken(
    userId: string,
    userAgent?: string,
    ip?: string,
    familyId?: string,
  ) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const resolvedFamilyId = familyId || crypto.randomUUID();

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        familyId: resolvedFamilyId,
        userAgent,
        ip,
        expiresAt,
      },
    });

    return rawToken;
  }

  async register(dto: RegisterDto, userAgent?: string, ip?: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    await this.issueEmailVerification(user.id, user.email);

    const access_token = await this.generateAccessToken(user);
    const refresh_token = await this.generateRefreshToken(
      user.id,
      userAgent,
      ip,
    );

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  /**
   * Confirms an email-verification token. Messaging endpoints require a
   * verified address, so this is the only way for a new account to unlock them.
   */
  async verifyEmail(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findUnique({
      where: { emailVerificationTokenHash: tokenHash },
    });

    if (
      !user ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        'Invalid or expired email verification token',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    return { message: 'Email verified', emailVerified: true };
  }

  /** Re-sends the verification email to the authenticated account. */
  async resendEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerified: true,
      },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('User not found');
    }

    if (user.emailVerified) {
      return { message: 'Email already verified', emailVerified: true };
    }

    await this.issueEmailVerification(user.id, user.email);

    return { message: 'Verification email sent', emailVerified: false };
  }

  private async issueEmailVerification(userId: string, email: string) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    if (this.emailService) {
      try {
        await this.emailService.sendTransactionalEmail({
          to: email,
          subject: 'Verify your PetAd email address',
          text: `Your email verification code is: ${rawToken}. It expires in 24 hours.`,
        });
      } catch (err) {
        this.logger.error(`Failed to send verification email: ${err}`);
      }
    }

    return rawToken;
  }

  async login(dto: LoginDto, userAgent?: string, ip?: string) {
    const key = dto.email;
    const attempts = this.loginAttempts.get(key);
    if (
      attempts &&
      attempts.count >= 5 &&
      Date.now() - attempts.lastAttempt < 15 * 60 * 1000
    ) {
      throw new UnauthorizedException('Too many login attempts');
    }
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || user.status === UserStatus.DELETED) {
      this.recordFailedAttempt(key);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Anonymised accounts have their password hash removed.
    const isPasswordValid =
      !!user.password && (await bcrypt.compare(dto.password, user.password));

    if (!isPasswordValid) {
      this.recordFailedAttempt(key);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.loginAttempts.delete(key);

    const access_token = await this.generateAccessToken(user);
    const refresh_token = await this.generateRefreshToken(
      user.id,
      userAgent,
      ip,
    );

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  async forgotPassword(email: string, ip: string) {
    const rateLimitKey = `${email}:${ip}`;
    const now = Date.now();
    const lastRequest = this.forgotRateLimitMap.get(rateLimitKey) || 0;
    const rateLimitWindowMs = 60 * 1000;

    if (now - lastRequest < rateLimitWindowMs) {
      this.logger.warn(
        `Rate limit exceeded for forgot password: ${rateLimitKey}`,
      );
      // Return 202 identical response for anti-enumeration and rate-limiting
      return {
        message: 'If the email exists, a password reset link has been sent.',
      };
    }

    this.forgotRateLimitMap.set(rateLimitKey, now);

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await this.prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt,
          used: false,
        },
      });

      if (this.emailService) {
        try {
          await this.emailService.sendTransactionalEmail({
            to: user.email,
            subject: 'Password Reset Request',
            text: `Your password reset token is: ${rawToken}. It expires in 30 minutes.`,
          });
        } catch (err) {
          this.logger.error(`Failed to send password reset email: ${err}`);
        }
      }
    }

    return {
      message: 'If the email exists, a password reset link has been sent.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !resetRecord ||
      resetRecord.used ||
      resetRecord.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used: true },
      });

      await tx.user.update({
        where: { id: resetRecord.userId },
        data: { password: hashedPassword },
      });

      await tx.passwordResetToken.deleteMany({
        where: { userId: resetRecord.userId, id: { not: resetRecord.id } },
      });

      // Revoke all active sessions on password reset
      await tx.session.updateMany({
        where: { userId: resetRecord.userId },
        data: { revokedAt: new Date() },
      });
    });

    if (this.emailService) {
      try {
        await this.emailService.sendTransactionalEmail({
          to: resetRecord.user.email,
          subject: 'Password Reset Successful',
          text: 'Your password has been successfully reset. All active sessions have been revoked.',
        });
      } catch (err) {
        this.logger.error(
          `Failed to send password reset confirmation email: ${err}`,
        );
      }
    }

    return { message: 'Password successfully reset' };
  }
}
