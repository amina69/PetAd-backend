import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscrowTimeoutJob } from './escrow-timeout.job';
import { PrismaModule } from '../prisma/prisma.module';
import { AdoptionModule } from '../adoption/adoption.module';
import { PetsModule } from '../pets/pets.module';

@Module({
  imports: [PrismaModule, AdoptionModule, PetsModule],
  providers: [EscrowService, EscrowTimeoutJob],
  exports: [EscrowService],
})
export class EscrowModule {}
