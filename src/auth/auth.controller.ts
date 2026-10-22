import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 requests per minute
  @Post('register')
  @ApiOperation({ summary: 'User Registration' })
  @ApiResponse({ status: 200, description: 'Registration successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 requests per minute
  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 requests per minute
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email address',
    description:
      'Confirms the caller email using the token received by email. No auth required.',
  })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired verification token',
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.emailVerificationService.verifyEmail(dto.token);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 requests per minute
  @UseGuards(JwtAuthGuard)
  @Post('email/resend')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Re-send email verification',
    description:
      'Re-sends the verification email to the authenticated user. Enforces a 60s cooldown (429 with Retry-After).',
  })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({
    status: 429,
    description: 'Cooldown active - Retry-After header indicates wait time',
  })
  async resendVerificationEmail(
    @CurrentUser() user: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = user.userId ?? user.sub;
    const result =
      await this.emailVerificationService.resendVerificationEmail(userId);

    if (result.status === 'throttled') {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        {
          code: 'RESEND_COOLDOWN',
          message: `Verification email already sent. Please wait ${result.retryAfterSeconds}s before requesting a new one.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return result;
  }
}
