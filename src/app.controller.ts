import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Get('protected')
  @UseGuards(JwtAuthGuard)
  getProtected(): string {
    return 'Protected route accessed';
  }
}

