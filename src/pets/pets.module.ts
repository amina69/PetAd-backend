import { Module } from '@nestjs/common';
import { PetsService } from './pets.service';
import { PetsController } from './pets.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PetAvailabilityService } from './services/pet-availability.service';

@Module({
  imports: [PrismaModule],
  controllers: [PetsController],
  providers: [PetsService, PetAvailabilityService],
  exports: [PetsService],
})
export class PetsModule {}
