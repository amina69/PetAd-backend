import { Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { CustodyController } from './custody.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { EscrowModule } from '../escrow/escrow.module';

@Module({
  imports: [PrismaModule, EventsModule, EscrowModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
