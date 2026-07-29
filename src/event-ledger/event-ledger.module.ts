import { Module } from '@nestjs/common';
import { EventReplayService } from './event-replay.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [EventReplayService],
  exports: [EventReplayService],
})
export class EventLedgerModule {}
