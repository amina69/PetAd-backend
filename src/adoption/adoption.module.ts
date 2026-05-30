import { Module } from '@nestjs/common';
import { AdoptionController } from './adoption.controller';
import { AdoptionService } from './adoption.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';

@Module({
  imports: [PrismaModule, DocumentsModule],
  controllers: [AdoptionController],
  providers: [AdoptionService, PetAvailabilityService],
})
export class AdoptionModule {}
