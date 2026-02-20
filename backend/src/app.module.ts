import { Module } from '@nestjs/common';
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

@Module({
  imports: [PrismaModule, PetsModule, AdoptionModule, CustodyModule, EscrowModule, EventsModule, StellarModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
