import { Module } from '@nestjs/common';
import { AdoptionController } from './adoption.controller';
import { AdoptionService } from './adoption.service';
import { AdoptionStateMachineService } from './services/adoption-state-machine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [AdoptionController],
  providers: [AdoptionService, AdoptionStateMachineService],
  exports: [AdoptionService],
})
export class AdoptionModule {}
