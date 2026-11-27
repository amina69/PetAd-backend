import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { SettlementService } from './settlement.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AdoptionModule } from '../adoption/adoption.module';
import { PetsModule } from '../pets/pets.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, AdoptionModule, PetsModule, EventsModule],
  providers: [EscrowService, SettlementService],
  exports: [EscrowService, SettlementService],
})
export class EscrowModule {}
