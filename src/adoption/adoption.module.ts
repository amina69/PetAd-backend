import { Module } from '@nestjs/common';
import { AdoptionController } from './adoption.controller';
import { AdoptionService } from './adoption.service';
import { AdoptionStateMachine } from './services/adoption-state-machine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { EventLedgerModule } from '../event-ledger/event-ledger.module';

@Module({
  imports: [PrismaModule, DocumentsModule, EventLedgerModule],
  controllers: [AdoptionController],
  providers: [AdoptionService, AdoptionStateMachine],
  exports: [AdoptionStateMachine],
})
export class AdoptionModule {}
