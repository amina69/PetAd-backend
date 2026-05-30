import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AdoptionModule } from '../adoption/adoption.module';

@Module({
  imports: [PrismaModule, AdoptionModule],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
