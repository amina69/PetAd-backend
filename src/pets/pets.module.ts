import { Module } from '@nestjs/common';
import { PetsService } from './pets.service';
import { PetsController } from './pets.controller';
import { PetsRepository } from './pets.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { PetAvailabilityService } from './services/pet-availability.service';
import { PetMovementService } from './services/pet-movement.service';
import { SheltersModule } from '../users/shelters/shelters.module';

@Module({
  imports: [PrismaModule, SheltersModule],
  controllers: [PetsController],
  providers: [
    PetsService,
    PetsRepository,
    PetAvailabilityService,
    PetMovementService,
  ],
  exports: [PetsService, PetAvailabilityService, PetMovementService],
})
export class PetsModule {}
