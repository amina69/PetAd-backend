import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { SigningPolicyService } from './signing-policy.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AdoptionModule } from '../adoption/adoption.module';
import { PetsModule } from '../pets/pets.module';

@Module({
  imports: [PrismaModule, AdoptionModule, PetsModule],
  providers: [EscrowService, SigningPolicyService],
  exports: [EscrowService, SigningPolicyService],
})
export class EscrowModule {}
