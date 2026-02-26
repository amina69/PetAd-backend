import { Module } from '@nestjs/common';
import { AdoptionController } from './adoption.controller';
import { AdoptionStateMachineController } from './adoption-state-machine.controller';
import { AdoptionService } from './adoption.service';
import { AdoptionStateMachine } from './adoption-state-machine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { PetsModule } from '../pets/pets.module';

@Module({
  imports: [
    PrismaModule,
    EventsModule,
    PetsModule,
  ],
  controllers: [
    AdoptionController,
    AdoptionStateMachineController,
  ],
  providers: [
    AdoptionService,
    AdoptionStateMachine,
  ],
  exports: [
    AdoptionService,
    AdoptionStateMachine,
  ],
})
export class AdoptionModule {}
