import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';


@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}


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
}






