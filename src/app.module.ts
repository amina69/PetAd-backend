import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { SentryModule } from './common/sentry/sentry.module';

import { LoggingInterceptor } from './logging/logging.interceptor';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { EventLedgerModule } from './event-ledger/event-ledger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Redis-backed throttling so rate limits are shared across application instances
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60000, limit: 100 },
        { name: 'auth', ttl: 60000, limit: 10 },
        { name: 'write', ttl: 60000, limit: 5 },
        { name: 'expensive', ttl: 60000, limit: 2 },
        { name: 'public-verify', ttl: 60000, limit: 20 },
      ],
      storage: new ThrottlerStorageRedisService({
        host: 'localhost',
        port: 6379,
      }),
    }),

    SentryModule.forFeature(),

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
export class AppModule {
  constructor(private readonly configService: ConfigService) {}
}