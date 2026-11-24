import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventLedgerService } from './event-ledger.service';
import { EventLedgerController } from './event-ledger.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [EventLedgerController],
  providers: [EventsService, EventLedgerService],
  exports: [EventsService, EventLedgerService],
})
export class EventsModule {}

export { custodyReducer } from './reducers/custody.reducer';
export { petAvailabilityReducer } from './reducers/pet-availability.reducer';
export { approvalReducer } from './reducers/approval.reducer';
export type { CreateEventLogDto } from './events.service';
