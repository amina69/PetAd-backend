import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { PetsModule } from './pets/pets.module';
import { AdoptionModule } from './adoption/adoption.module';
import { CustodyModule } from './custody/custody.module';
import { EscrowModule } from './escrow/escrow.module';
import { EventsModule } from './events/events.module';
import { StellarModule } from './stellar/stellar.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

import { LoggingInterceptor } from './logging/logging.interceptor';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { EventLedgerModule } from './event-ledger/event-ledger.module';
import { configuration } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),

    // Redis-backed throttling shared across application instances.
    // Named throttlers with stricter limits for sensitive routes.
    // The ThrottlerStorageRedisService reads REDIS_URL from process.env
    // and uses ioredis to store rate limit state in Redis.
    ThrottlerModule.forRoot({
      // Default throttler: 100 requests per 60s
      throttlers: [
        {
          ttl: 60000,
          limit: 100,
        },
        // Auth throttler: 10 requests per 60s - stricter for login, forgot password, resend
        {
          ttl: 60000,
          limit: 10,
          name: 'auth',
        },
        // Write throttler: 20 requests per 60s - stricter for write operations
        {
          ttl: 60000,
          limit: 20,
          name: 'write',
        },
        // Expensive throttler: 5 requests per 60s - for resource-intensive endpoints
        {
          ttl: 60000,
          limit: 5,
          name: 'expensive',
        },
        // Public verify throttler: 30 requests per 60s - for verify-proof endpoints
        {
          ttl: 60000,
          limit: 30,
          name: 'public-verify',
        },
      ],
      // Redis-backed storage enables shared rate limits across
      // multiple running application instances. The service reads
      // REDIS_URL from process.env automatically.
      storage: new ThrottlerStorageRedisService(),
    }),

    PrismaModule,
    PetsModule,
    AdoptionModule,
    CustodyModule,
    EscrowModule,
    EventsModule,
    StellarModule,
    AuthModule,
    HealthModule,
    LoggingModule,
    JobsModule,
    AdminModule,
    EventLedgerModule,
  ],

  controllers: [AppController],
  providers: [
    AppService,
    HttpExceptionFilter,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
