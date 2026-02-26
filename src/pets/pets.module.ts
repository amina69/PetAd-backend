import { Module } from '@nestjs/common';
import { PetsService } from './pets.service';
import { PetsController } from './pets.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PetAvailabilityService } from './pet-availability.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [PetsController],
  providers: [PetsService, PetAvailabilityService],
  exports: [PetsService, PetAvailabilityService],
})
export class PetsModule {}
