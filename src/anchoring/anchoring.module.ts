import { Module } from '@nestjs/common';
import { ProofService } from './proof.service';
import { ProofController } from './proof.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProofController],
  providers: [ProofService],
  exports: [ProofService],
})
export class AnchoringModule {}
