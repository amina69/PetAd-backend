import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscrowReconcilerJob } from './escrow-reconciler.job';
import { PrismaModule } from '../prisma/prisma.module';
import { AdoptionModule } from '../adoption/adoption.module';
import { PetsModule } from '../pets/pets.module';

@Module({
  imports: [PrismaModule, AdoptionModule, PetsModule],
  providers: [EscrowService, EscrowReconcilerJob],
  exports: [EscrowService],
})
export class EscrowModule {}
