import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EventsService } from './events.service';
import { PrismaModule } from '../prisma/prisma.module';
import {
  ANCHORING_QUEUE,
  EventLedgerService,
} from '../event-ledger/event-ledger.service';
import {
  getRedisConnection,
  getJobAttempts,
  getJobBackoffDelay,
} from '../jobs/queues/queue.config';

@Global()
@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [
    EventsService,
    EventLedgerService,
    {
      provide: ANCHORING_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Queue(ANCHORING_QUEUE, {
          connection: getRedisConnection(configService),
          defaultJobOptions: {
            attempts: getJobAttempts(configService),
            backoff: {
              type: 'fixed',
              delay: getJobBackoffDelay(configService),
            },
          },
        }),
    },
  ],
  exports: [EventsService, EventLedgerService],
})
export class EventsModule {}

export { custodyReducer } from './reducers/custody.reducer';
export { petAvailabilityReducer } from './reducers/pet-availability.reducer';
export type { CreateEventLogDto } from './events.service';
