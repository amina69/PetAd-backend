import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventsService } from './events.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    BullModule.processQueue('events', { concurrency: 10 }),
  ],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
