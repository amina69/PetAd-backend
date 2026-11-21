import { Global, Module } from '@nestjs/common';
import { EventLedgerService } from './event-ledger.service';
import { EventLedgerRepository } from './event-ledger.repository';
import { EventLedgerController } from './event-ledger.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Global module for the Event Ledger — the append-only event store.
 *
 * Being @Global, EventLedgerService can be injected from any module
 * without an explicit import.
 */
@Global()
@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [EventLedgerController],
  providers: [EventLedgerService, EventLedgerRepository],
  exports: [EventLedgerService, EventLedgerRepository],
})
export class EventLedgerModule {}
