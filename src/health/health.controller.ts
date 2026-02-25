import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  PrismaHealthIndicator
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClient } from '@prisma/client';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: PrismaHealthIndicator,
    private prisma: PrismaService,
  ) { }



  @Get()
  @HealthCheck()
  async check() {
    try {
      // Manual check to see if Prisma can actually run a query
      await this.prisma.$queryRaw`SELECT 1`;
      console.log('Manual ping success');
    } catch (e) {
      console.error('Manual ping failed:', e.message);
    }

    return this.health.check([
      () => this.db.pingCheck('database', this.prisma),
    ]);
  }
  // @Get()
  // @HealthCheck()
  // check() {
  //   return this.health.check([
  //     // This checks if the database is reachable via Prisma
  //   () => this.db.pingCheck('database', this.prisma as PrismaClient),
  //   ]);
  // }
}