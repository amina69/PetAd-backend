import { Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { CustodyController } from './custody.controller';
import { CustodyStateMachine } from './services/custody-state-machine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { EscrowModule } from '../escrow/escrow.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, EventsModule, EscrowModule, UsersModule],
  controllers: [CustodyController],
  providers: [CustodyService, CustodyStateMachine],
  exports: [CustodyService, CustodyStateMachine],
})
export class CustodyModule {}
