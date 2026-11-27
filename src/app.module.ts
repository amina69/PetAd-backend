import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { PetsModule } from './pets/pets.module';
import { AdoptionModule } from './adoption/adoption.module';
import { SettingsModule } from './settings/settings.module';
import { CustodyModule } from './custody/custody.module';
import { EscrowModule } from './escrow/escrow.module';
import { EventsModule } from './events/events.module';
import { StellarModule } from './stellar/stellar.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TtlCacheModule } from './common/cache/ttl-cache.module';

import { LoggingInterceptor } from './logging/logging.interceptor';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { AdminBulkModule } from './admin/bulk/bulk.module';
import { EventLedgerModule } from './event-ledger/event-ledger.module';
import { FlagsModule } from './flags/flags.module';
import { configuration } from './config/configuration';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // To be used only when limits needs to be persisted upon restart

    // ThrottlerModule.forRoot({
    //   throttlers: [{ ttl: 60000, limit: 100 }],
    //   storage: new ThrottlerStorageRedisService({
    //     host: 'redis',  // Docker service name
    //     port: 6379,
    //   }),
    // }),

    MetricsModule,
    PrismaModule,
    PetsModule,
    AdoptionModule,
    SettingsModule,
    CustodyModule,
    EscrowModule,
    EventsModule,
    StellarModule,
    AuthModule,
    HealthModule,
    LoggingModule,
    TtlCacheModule,
    JobsModule,
    AdminModule,
    AdminBulkModule,
    EventLedgerModule,
    FlagsModule,
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
