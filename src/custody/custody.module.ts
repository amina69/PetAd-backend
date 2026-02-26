import { Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { CustodyController } from './custody.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { EscrowModule } from '../escrow/escrow.module';
import { UsersModule } from '../users/users.module';
import { PetsModule } from '../pets/pets.module';

@Module({
  imports: [PrismaModule, EventsModule, EscrowModule, UsersModule, PetsModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
