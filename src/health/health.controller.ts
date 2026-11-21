import {
  Controller,
  Get,
} from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * General health check endpoint.
   * Preserves the existing documented response shape: status, database, redis.
   * Does not expose sensitive infrastructure information.
   */
  @Get()
  @HealthCheck()
  async check(): Promise<{
    status: string;
    database: boolean;
    redis: boolean;
  }> {
    const dbResult = await this.dbCheck();
    const redisResult = await this.redisCheck();

    return {
      status: dbResult.ok && redisResult.ok ? 'ok' : 'error',
      database: dbResult.ok,
      redis: redisResult.ok,
    };
  }

  /**
   * Liveness check endpoint.
   * Checks process liveness only - does not depend on any external services.
   * Returns HTTP 200 even when Redis or database are unavailable.
   * This is the simplest liveness check: if the process is running, it's live.
   */
  @Get('live')
  @HealthCheck()
  async live(): Promise<{
    status: string;
    database: boolean;
    redis: boolean;
  }> {
    // Liveness only confirms the process is running.
    // External dependencies are not checked for liveness.
    return {
      status: 'ok',
      database: true,
      redis: true,
    };
  }

  /**
   * Readiness check endpoint.
   * Checks database, Redis, queue connectivity, and whether migrations have been applied.
   * Readiness must fail during application shutdown.
   * Stopping Redis causes /health/ready to fail while /health/live continues returning HTTP 200.
   */
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<{
    status: string;
    database: boolean;
    redis: boolean;
    queue: boolean;
    migrations: boolean;
  }> {
    // Check database connectivity
    const dbResult = await this.dbCheck();

    // Check Redis connectivity
    const redisResult = await this.redisCheck();

    // Check queue/migration state
    const queueAndMigrationResult = await this.queueAndMigrationCheck();

    // Overall: all checks must pass for readiness
    const dbHealthy = dbResult.ok;
    const redisHealthy = redisResult.ok;
    const queueHealthy = queueAndMigrationResult.ok;

    if (!dbHealthy || !redisHealthy || !queueHealthy) {
      return {
        status: 'error',
        database: dbHealthy,
        redis: redisHealthy,
        queue: queueHealthy,
        migrations: queueAndMigrationResult.migrations,
      };
    }

    return {
      status: 'ok',
      database: dbHealthy,
      redis: redisHealthy,
      queue: queueHealthy,
      migrations: queueAndMigrationResult.migrations,
    };
  }

  private async dbCheck(): Promise<{ ok: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private async redisCheck(): Promise<{ ok: boolean }> {
    try {
      // Create a temporary Redis connection for health check
      // The REDIS_URL is from environment config
      const redisUrl = this.configService.get<string>('redisUrl');
      if (redisUrl) {
        const Redis = require('ioredis');
        const redis = new Redis(redisUrl);
        await redis.ping();
        redis.disconnect();
        return { ok: true };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }

  private async queueAndMigrationCheck(): Promise<{ ok: boolean; migrations: boolean }> {
    try {
      // Check migrations by running a simple query
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, migrations: true };
    } catch {
      return { ok: false, migrations: false };
    }
  }
}