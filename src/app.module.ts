import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdoptionModule } from './adoption/adoption.module';
import { AuthModule } from './auth/auth.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { CustodyModule } from './custody/custody.module';
import { DocumentsModule } from './documents/documents.module';
import { EmailModule } from './email/email.module';
import { EscrowModule } from './escrow/escrow.module';
import { EventLedgerModule } from './event-ledger/event-ledger.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { LoggingModule } from './logging/logging.module';
import { PetsModule } from './pets/pets.module';
import { PrismaModule } from './prisma/prisma.module';
import { StellarModule } from './stellar/stellar.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    PetsModule,
    AdoptionModule,
    CustodyModule,
    EscrowModule,
    EventsModule,
    EventLedgerModule,
    CloudinaryModule,
    DocumentsModule,
    EmailModule,
    JobsModule,
    HealthModule,
    LoggingModule,
    StellarModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
