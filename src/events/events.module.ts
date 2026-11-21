import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventLedgerService } from './event-ledger.service';
import { EventBusService } from './event-bus.service';
import { EventLedgerController } from './event-ledger.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [EventLedgerController],
  providers: [EventsService, EventLedgerService, EventBusService],
  exports: [EventsService, EventLedgerService, EventBusService],
})
export class EventsModule {}

export { custodyReducer } from './reducers/custody.reducer';
export { petAvailabilityReducer } from './reducers/pet-availability.reducer';
export type { CreateEventLogDto } from './events.service';
