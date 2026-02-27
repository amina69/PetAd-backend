import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './logging/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    
  ],
  
  controllers: [AppController],
  providers: [
     {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    AppService, HttpExceptionFilter],
  
})

export class AppModule { }
