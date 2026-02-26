import { Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { PetsModule } from '../pets/pets.module';

@Module({
  imports: [PrismaModule, EventsModule, PetsModule],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
