import { Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { CustodyController } from './custody.controller';
import { CustodyStateMachine } from './custody-state-machine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { EscrowModule } from '../escrow/escrow.module';
import { UsersModule } from '../users/users.module';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';

@Module({
  imports: [PrismaModule, EventsModule, EscrowModule, UsersModule],
  controllers: [CustodyController],
  providers: [CustodyService, CustodyStateMachine, PetAvailabilityService],
  exports: [CustodyService, CustodyStateMachine],
})
export class CustodyModule {}
