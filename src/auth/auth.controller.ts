import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;
    const result = await this.authService.register(dto, userAgent, ip);
    this.setRefreshTokenCookie(res, result.refresh_token);
    return { access_token: result.access_token, user: result.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: 201, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;
    const result = await this.authService.login(dto, userAgent, ip);
    this.setRefreshTokenCookie(res, result.refresh_token);
    return { access_token: result.access_token, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or reused refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      (req as any).cookies?.refresh_token || req.body?.refresh_token;
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;
    const result = await this.authService.refresh(token, userAgent, ip);
    this.setRefreshTokenCookie(res, result.refresh_token);
    return { access_token: result.access_token, user: result.user };
  }

  private setRefreshTokenCookie(res: Response, token: string) {
    const isProd = this.configService.get('NODE_ENV') === 'production';
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@Req() req: Request) {
    const user = req.user as { sub?: string; userId?: string } | undefined;
    return this.authService.getCurrentUser(user?.sub ?? user?.userId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout() {
    return this.authService.logout();
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address with a token' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired verification token',
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Re-send the email verification message' })
  @ApiResponse({ status: 202, description: 'Verification email sent' })
  @ApiResponse({ status: 409, description: 'Email already verified' })
  @ApiResponse({
    status: 429,
    description: 'Cooldown active (Retry-After header set)',
  })
  async resendEmailVerification(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as { sub?: string; userId?: string } | undefined;
    const userId = user?.userId ?? user?.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    try {
      return await this.authService.resendVerificationEmail(userId);
    } catch (error) {
      // Surface the cooldown as a Retry-After header, not just in the body.
      if (error instanceof HttpException) {
        const payload = error.getResponse();
        if (
          payload &&
          typeof payload === 'object' &&
          typeof (payload as { retryAfterSeconds?: unknown })
            .retryAfterSeconds === 'number'
        ) {
          const { retryAfterSeconds } = payload as {
            retryAfterSeconds: number;
          };
          res.setHeader('Retry-After', String(retryAfterSeconds));
        }
      }
      throw error;
    }
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({
    status: 202,
    description: 'Password reset request accepted',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      'unknown';
    return this.authService.forgotPassword(dto.email, ip);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using reset token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
