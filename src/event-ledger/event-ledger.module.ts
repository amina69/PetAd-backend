import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventLedgerController } from './event-ledger.controller';
import { EventLedgerRepository } from './event-ledger.repository';
import { EventLedgerService } from './event-ledger.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [EventLedgerController],
  providers: [EventLedgerRepository, EventLedgerService],
  exports: [EventLedgerRepository, EventLedgerService],
})
export class EventLedgerModule {}
