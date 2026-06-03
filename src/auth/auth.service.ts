import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthProvider } from '@prisma/client';

interface GoogleProfile {
  email: string;
  firstName: string;
  lastName: string;
  providerId: string;
  avatarUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private async signToken(userId: string, email: string, role: string) {
    return this.jwtService.signAsync({ sub: userId, email, role });
  }

  async register(dto: RegisterDto) {
    const { email, password, firstName, lastName } = dto;
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        password: passwordHash,
        firstName,
        lastName,
        provider: AuthProvider.LOCAL,
      },
    });
    const access_token = await this.signToken(user.id, user.email, user.role);
    return {
      access_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async login(dto: LoginDto) {
    const { email, password } = dto;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const access_token = await this.signToken(user.id, user.email, user.role);
    return {
      access_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async googleLogin(profile: GoogleProfile) {
    const { email, firstName, lastName, providerId, avatarUrl } = profile;

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      // Link Google to existing local account if not already linked
      if (user.provider === AuthProvider.LOCAL && !user.providerId) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            provider: AuthProvider.GOOGLE,
            providerId,
            avatarUrl: user.avatarUrl ?? avatarUrl,
          },
        });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          provider: AuthProvider.GOOGLE,
          providerId,
          avatarUrl,
        },
      });
    }

    const access_token = await this.signToken(user.id, user.email, user.role);
    return {
      access_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
