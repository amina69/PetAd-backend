import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
