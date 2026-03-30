import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}

