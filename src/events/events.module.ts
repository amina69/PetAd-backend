import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global() // Makes EventsService available application-wide without needing to import EventsModule everywhere
@Module({
  imports: [PrismaModule],
  providers: [EventsService],
  exports: [EventsService], // Export it so other modules can use it
})
export class EventsModule {}
